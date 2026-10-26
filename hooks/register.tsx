import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Topic } from '../types'

const topics = atom({ plugin: 'offtopic', key: 'topics' } as const, [] as Topic[], { shape: 'topics-1' })
// Classifications asked of the model and not yet answered.
const pending = atom({ plugin: 'offtopic', key: 'pending' } as const, 0)
const isHidden = atom({ plugin: 'offtopic', key: 'isHidden' } as const, false)
// Whether the exchanges from before the mod loaded have been classified.
const isSeeded = atom({ plugin: 'offtopic', key: 'isSeeded' } as const, false)

const MODEL = 'haiku'
const CLIP = 1200
const MAX_BARS = 6

type $ = Parameters<Hook<'turn.complete'>>[0]
type Exchange = { prompt: string; answer: string }

const SYSTEM = [
  'You label the topic of exchanges between a user and an AI coding assistant.',
  'A topic is 1 to 3 lowercase words naming what the exchange is about (e.g. "mod authoring", "github publishing", "small talk").',
  'Reuse an existing topic, spelled exactly, whenever the exchange fits it; make a new one only for a different subject.',
  'Reply with the topics alone, no explanation.',
].join(' ')

const clip = (text: string) => (text.length > CLIP ? `${text.slice(0, CLIP)}…` : text)

const describe = (exchange: Exchange) => `User: ${clip(exchange.prompt)}\nAssistant: ${clip(exchange.answer)}`

// A model's label made safe for the band: one line, lowercase, short, and the
// existing topic's own spelling where it names one.
const tidy = (label: string, known: readonly Topic[]) => {
  const name = (label.split('\n')[0] ?? '')
    .replace(/^\s*#?\d+\s*[:.)-]\s*/, '')
    .replace(/["'`*.]/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 28)

  return known.find(topic => topic.name === name)?.name ?? (name || 'other')
}

const add = (list: readonly Topic[], name: string) =>
  list.some(topic => topic.name === name)
    ? list.map(topic => (topic.name === name ? { ...topic, count: topic.count + 1 } : topic))
    : [...list, { name, count: 1 }]

const ask = async ($: $, prompt: string, maxTokens: number) => {
  await update($, pending, n => n + 1)
  try {
    const reply = await $.model.complete({ model: MODEL, system: SYSTEM, prompt, maxTokens, timeoutMs: 60_000 })

    return reply.isAnswered ? reply.text : undefined
  } finally {
    await update($, pending, n => Math.max(0, n - 1))
  }
}

// Labels one finished exchange and counts it.
const classify = async ($: $, exchange: Exchange) => {
  const known = await read($, topics)
  const list = known.map(topic => topic.name).join(', ') || '(none yet)'
  const text = await ask($, `Existing topics: ${list}\n\nLabel this exchange with one topic.\n\n${describe(exchange)}`, 20)
  if (text !== undefined) {
    await update($, topics, now => add(now, tidy(text, now)))
  }
}

// The session's exchanges so far: each prompt the person typed and the last
// text Claude answered it with.
const exchangesOf = async ($: $) => {
  const messages = await $.session.messages()
  const exchanges: Exchange[] = []
  if ('deny' in messages) {
    return exchanges
  }
  for (const message of messages) {
    const last = exchanges[exchanges.length - 1]
    if (message.role === 'user' && message.text.trim() !== '' && !message.toolResults?.length) {
      exchanges.push({ prompt: message.text, answer: '' })
    } else if (message.role === 'assistant' && message.text.trim() !== '' && last) {
      last.answer = message.text
    }
  }

  return exchanges.filter(exchange => exchange.answer !== '').slice(-40)
}

// Classifies the exchanges from before the mod loaded, in one call.
const seed = async ($: $) => {
  if (await read($, isSeeded)) {
    return
  }
  await update($, isSeeded, () => true)
  const exchanges = await exchangesOf($)
  if (exchanges.length === 0) {
    return
  }
  const numbered = exchanges.map((exchange, i) => `#${i + 1}\n${describe(exchange)}`).join('\n\n')
  const text = await ask(
    $,
    `Label each of these ${exchanges.length} exchanges with one topic, reusing topics across them. Reply with one line per exchange, in order, as "<number>: <topic>".\n\n${numbered}`,
    16 * exchanges.length + 50,
  )
  if (text === undefined) {
    await update($, isSeeded, () => false)

    return
  }
  const labels = text.split('\n').filter(line => /^\s*#?\d+\s*[:.)-]/.test(line))
  await update($, topics, now => labels.reduce((list, label) => add(list, tidy(label, list)), now))
}

// The prompt the person sent last, paired with the answer when its turn ends.
let lastPrompt = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'offtopic',
      description: 'Show or hide the topic histogram; /offtopic reset starts it over',
    })
    const started = await next(e)
    void seed($).catch(() => {})

    return started
  })

  on('command.run', { command: 'offtopic' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await update($, topics, () => [])
      await update($, isSeeded, () => false)
      void seed($).catch(() => {})

      return { text: 'Topic histogram reset; classifying this session again.' }
    }
    const hidden = await update($, isHidden, was => !was)

    return { text: hidden ? 'Topic histogram hidden.' : 'Topic histogram shown.' }
  })

  on('prompt.submit', ($, e, next) => {
    if (!e.command && !e.isMeta) {
      lastPrompt = e.text
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && !e.isAborted && e.answer.trim() !== '' && lastPrompt !== '') {
      const exchange = { prompt: lastPrompt, answer: e.answer }
      lastPrompt = ''
      void classify($, exchange).catch(() => {})
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Another plugin's band (word-counter's) is drawn below this one, not replaced.
    const below = await next(e)
    const list = await read($, topics)
    const waiting = await read($, pending)
    if (e.props.hasSurvey || (await read($, isHidden)) || (list.length === 0 && waiting === 0)) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const sorted = [...list].sort((a, b) => b.count - a.count)
    const total = sorted.reduce((sum, topic) => sum + topic.count, 0)
    const main = sorted[0]
    const off = total === 0 || !main ? 0 : Math.round(((total - main.count) / total) * 100)
    const bars = sorted.slice(0, Math.max(1, Math.min(MAX_BARS, e.props.maxRows - 3)))
    const rest = sorted.length - bars.length
    const labelWidth = Math.min(28, Math.max(5, ...bars.map(topic => topic.name.length)))
    const countWidth = String(main?.count ?? 0).length
    const barRoom = Math.max(5, e.props.bodyColumns - labelWidth - countWidth - 4)
    const most = main?.count ?? 1

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>offtopic</Text>
          <Text dimColor>
            {' '}
            · {total} exchanges · main: {main?.name ?? '…'} ·{' '}
          </Text>
          <Text color={off >= 50 ? 'red' : off >= 25 ? 'yellow' : 'green'}>{off}% off-topic</Text>
          {waiting > 0 && <Text dimColor> · classifying…</Text>}
        </Text>
        {bars.map((topic, i) => (
          <Text key={`bar:${topic.name}`} wrap="truncate-end">
            <Text color={i === 0 ? 'green' : undefined} dimColor={i !== 0}>
              {topic.name.padEnd(labelWidth)}{' '}
            </Text>
            <Text color={i === 0 ? 'green' : 'yellow'}>
              {'█'.repeat(Math.max(1, Math.round((topic.count / most) * barRoom)))}
            </Text>
            <Text dimColor> {topic.count}</Text>
          </Text>
        ))}
        {rest > 0 && <Text dimColor>+{rest} more topics</Text>}
        {below}
      </Box>
    )
  })
}
