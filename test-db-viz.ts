/**
 * Test script for database visualization with Claude Agent
 *
 * This script demonstrates how to:
 * 1. Query data from a database (credentials baked into E2B template)
 * 2. Create visualizations with Python
 * 3. Retrieve the generated chart files
 *
 * Usage:
 *   bun test-db-viz.ts
 *   bun test-db-viz.ts "Show me monthly sales as a bar chart"
 *
 * Required environment variables:
 *   - ANTHROPIC_API_KEY
 *   - E2B_API_KEY
 *
 * Note: Database credentials (DATABASE_URL, etc.) are baked into the E2B template
 * at build time via packages/e2b-build/build.prod.ts
 */

// Use the published npm package - no modifications needed
import { ClaudeAgentClient } from '@dzhng/claude-agent'
import { FilesystemEventType } from '@dzhng/claude-agent/types'
import { mkdir } from 'node:fs/promises'

// Validate environment
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const E2B_API_KEY = process.env.E2B_API_KEY

if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable is required')
  process.exit(1)
}

if (!E2B_API_KEY) {
  console.error('❌ E2B_API_KEY environment variable is required')
  process.exit(1)
}

// Get prompt from command line or use default
const prompt =
  process.argv[2] ||
  'Connect to the database and show me the tables available. Then pick an interesting table and create a visualization of the data. Save the chart as chart.png'

// System prompt for database visualization
const systemPrompt = `You are a data analyst assistant with access to a PostgreSQL read replica database and S3 for storing results.

## Database Connection
Use the DATABASE_URL environment variable to connect:
\`\`\`python
import os
import psycopg2
import pandas as pd

conn = psycopg2.connect(os.environ['DATABASE_URL'])
# Or use SQLAlchemy:
from sqlalchemy import create_engine
engine = create_engine(os.environ['DATABASE_URL'])
df = pd.read_sql("SELECT * FROM table_name LIMIT 100", engine)
\`\`\`

## Guidelines
1. This is a READ REPLICA - only run SELECT queries, never modify data
2. Always LIMIT your queries to avoid pulling too much data (start with LIMIT 100)
3. Use pandas for data manipulation
4. Use matplotlib or seaborn for visualizations
5. Save all charts locally first, then upload to S3
6. Print summaries of what you find
7. Always provide the S3 URL of uploaded charts in your response

## Creating Visualizations
\`\`\`python
import matplotlib.pyplot as plt
import seaborn as sns

# Create your visualization
plt.figure(figsize=(10, 6))
# ... your plot code ...
plt.savefig('chart.png', dpi=150, bbox_inches='tight')
plt.close()
print("Chart saved to chart.png")
\`\`\`

## Uploading to S3
After creating a chart, upload it to S3 and return the URL:
\`\`\`python
import os
import boto3
from datetime import datetime

def upload_to_s3(local_file: str, prefix: str = 'charts') -> str:
    """Upload a file to S3 and return the public URL."""
    s3 = boto3.client(
        's3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_REGION', 'us-east-1')
    )

    bucket = os.environ['S3_BUCKET']

    # Generate unique filename with timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.basename(local_file)
    s3_key = f"{prefix}/{timestamp}_{filename}"

    # Upload the file
    s3.upload_file(
        local_file,
        bucket,
        s3_key,
        ExtraArgs={'ContentType': 'image/png'}
    )

    # Return the URL
    region = os.environ.get('AWS_REGION', 'us-east-1')
    url = f"https://{bucket}.s3.{region}.amazonaws.com/{s3_key}"
    print(f"Uploaded to: {url}")
    return url

# Usage:
# url = upload_to_s3('chart.png')
\`\`\`

## Workflow
When asked to visualize data:
1. First explore the schema to understand what's available
2. Query relevant data with appropriate limits
3. Create clear, well-labeled visualizations
4. Save charts as PNG files locally
5. Upload charts to S3 using the upload_to_s3 function
6. Include the S3 URL in your response so the user can view the chart
7. Explain what the visualization shows`

async function main() {
  console.log('🚀 Starting database visualization test...\n')
  console.log('📝 Prompt:', prompt)
  console.log('ℹ️  Database credentials are baked into the E2B template')
  console.log('')

  // Use the standard client - env vars are already in the template
  const client = new ClaudeAgentClient({
    debug: true,
    systemPrompt,
    // template: 'claude-agent-server-jacob', // Your custom template name
  })

  const createdFiles: string[] = []

  try {
    await client.start()

    // Watch for file changes to track created charts
    console.log('👀 Setting up file watcher...')
    const watchHandle = await client.watchDir(
      '.',
      (event) => {
        if (event.type === FilesystemEventType.CREATE || event.type === FilesystemEventType.WRITE) {
          console.log(`📄 File created/modified: ${event.name}`)
          if (event.name.endsWith('.png') || event.name.endsWith('.jpg') || event.name.endsWith('.svg')) {
            createdFiles.push(event.name)
          }
        }
      },
      { recursive: true }
    )
    console.log('✅ File watcher active\n')

    // Handle completion
    const stopAndSaveCharts = async () => {
      console.log('\n' + '─'.repeat(60))
      console.log('✅ Task completed!')

      // Download any created chart files
      if (createdFiles.length > 0) {
        console.log(`\n📊 Downloading ${createdFiles.length} chart(s)...`)

        // Create output directory
        await mkdir('./output', { recursive: true })

        for (const file of createdFiles) {
          try {
            const content = await client.readFile(file, 'blob')
            const outputPath = `./output/${file.split('/').pop()}`
            await Bun.write(outputPath, content)
            console.log(`   ✅ Saved: ${outputPath}`)
          } catch (err) {
            console.log(`   ❌ Failed to download ${file}: ${err}`)
          }
        }
      } else {
        console.log('\n📊 No chart files were created')
      }

      await watchHandle.stop()
      await client.stop()
      console.log('\n👋 Done!')
      process.exit(0)
    }

    // Register message handler
    client.onMessage(async (message) => {
      switch (message.type) {
        case 'connected':
          console.log('🔗 Connected to sandbox')
          break

        case 'error':
          console.error('❌ Error:', message.error)
          break

        case 'sdk_message':
          const data = message.data as any

          switch (data.type) {
            case 'assistant':
              if (data.message?.content) {
                const content = data.message.content
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text') {
                      console.log('\n🤖 Claude:', block.text)
                    } else if (block.type === 'tool_use') {
                      console.log(`\n🔧 Tool: ${block.name}`)
                      // Show truncated input for readability
                      const inputStr = JSON.stringify(block.input)
                      console.log('   Input:', inputStr.slice(0, 200) + (inputStr.length > 200 ? '...' : ''))
                    }
                  }
                } else {
                  console.log('\n🤖 Claude:', content)
                }
              }
              break

            case 'tool_result':
              // Show truncated output
              const output = typeof data.content === 'string' ? data.content : JSON.stringify(data.content)
              const truncated = output.slice(0, 500) + (output.length > 500 ? '...' : '')
              console.log(`\n📋 Result: ${truncated}`)
              break

            case 'result':
              console.log('\n✅ Completed!')
              console.log('   Duration:', data.duration_ms, 'ms')
              console.log('   Cost: $' + (data.total_cost_usd || 0).toFixed(4))
              await stopAndSaveCharts()
              break

            default:
              // Ignore other message types to reduce noise
              break
          }
          break
      }
    })

    // Send the prompt
    console.log('📤 Sending prompt...\n')
    client.send({
      type: 'user_message',
      data: {
        type: 'user',
        session_id: 'db-viz-session',
        message: {
          role: 'user',
          content: prompt,
        },
      },
    })

    // Keep alive - will exit when result is received
    console.log('⏳ Waiting for Claude to complete...\n')
  } catch (error) {
    console.error('❌ Error:', error)
    await client.stop()
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
