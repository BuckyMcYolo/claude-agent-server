/**
 * Simple test script for the Claude Agent WebSocket server
 *
 * Usage:
 *   bun test.ts                           # Run with default prompt
 *   bun test.ts "Your custom prompt"      # Run with custom prompt
 *
 * Make sure the server is running first:
 *   bun run start:server
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable is required')
  console.error('   Add it to your .env file or export it in your shell')
  process.exit(1)
}

// Get prompt from command line args or use default
const prompt = process.argv[2] || 'Hello! What can you do? Please give a brief response.'

async function main() {
  console.log('📡 Configuring server...')

  // Configure the server with API key
  const configResponse = await fetch('http://localhost:3000/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anthropicApiKey: ANTHROPIC_API_KEY,
    }),
  })

  if (!configResponse.ok) {
    console.error('❌ Failed to configure server:', await configResponse.text())
    console.error('   Is the server running? Try: bun run start:server')
    process.exit(1)
  }

  console.log('✅ Server configured')
  console.log('🔌 Connecting to WebSocket...')

  const ws = new WebSocket('ws://localhost:3000/ws')

  ws.onopen = () => {
    console.log('✅ Connected!\n')
    console.log('📤 Sending prompt:', prompt)
    console.log('─'.repeat(60))

    ws.send(
      JSON.stringify({
        type: 'user_message',
        data: {
          type: 'user',
          session_id: 'test-session',
          message: {
            role: 'user',
            content: prompt,
          },
        },
      })
    )
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)

    switch (msg.type) {
      case 'connected':
        console.log('🔗 Connection confirmed')
        break

      case 'error':
        console.error('❌ Error:', msg.error)
        break

      case 'info':
        console.log('ℹ️ ', msg.data)
        break

      case 'sdk_message':
        const data = msg.data

        switch (data.type) {
          case 'assistant':
            // Handle text content
            if (data.message?.content) {
              const content = data.message.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    console.log('\n🤖 Claude:', block.text)
                  } else if (block.type === 'tool_use') {
                    console.log(`\n🔧 Tool: ${block.name}`)
                    console.log('   Input:', JSON.stringify(block.input, null, 2))
                  }
                }
              } else {
                console.log('\n🤖 Claude:', content)
              }
            }
            break

          case 'tool_result':
            console.log(`\n📋 Tool Result (${data.tool_use_id}):`)
            if (data.content) {
              const preview = typeof data.content === 'string'
                ? data.content.slice(0, 500)
                : JSON.stringify(data.content).slice(0, 500)
              console.log('  ', preview)
            }
            break

          case 'result':
            console.log('\n' + '─'.repeat(60))
            console.log('✅ Completed!')
            console.log('   Session:', data.session_id)
            console.log('   Duration:', data.duration_ms, 'ms')
            console.log('   Cost: $' + (data.total_cost_usd || 0).toFixed(4))
            ws.close()
            process.exit(0)
            break

          default:
            // Log other message types for debugging
            console.log(`\n📨 [${data.type}]`, JSON.stringify(data, null, 2).slice(0, 200))
        }
        break

      default:
        console.log('📨 Unknown:', msg)
    }
  }

  ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error)
    process.exit(1)
  }

  ws.onclose = () => {
    console.log('👋 Disconnected')
  }
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
