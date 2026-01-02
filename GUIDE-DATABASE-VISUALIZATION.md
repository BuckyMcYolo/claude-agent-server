# Database Visualization with Claude Agent Server

A comprehensive guide for setting up Claude Agent Server to query databases, create visualizations, and upload results to S3 with multi-tenant row-level security.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [One-Time Setup](#one-time-setup)
  - [1. Database Setup (Row-Level Security)](#1-database-setup-row-level-security)
  - [2. S3 Bucket Setup](#2-s3-bucket-setup)
  - [3. Environment Variables](#3-environment-variables)
  - [4. Build E2B Template](#4-build-e2b-template)
- [Per-Session Usage](#per-session-usage)
- [Security Model](#security-model)
- [Code Examples](#code-examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

This setup allows you to:

1. **Query a database** - Claude can run SQL queries against your read replica
2. **Create visualizations** - Generate charts with Python (matplotlib, seaborn, plotly)
3. **Upload to S3** - Store charts in S3 and return URLs to your app
4. **Multi-tenant isolation** - Each user only sees their own data via Row-Level Security

**Key Features:**
- Uses the published `@dzhng/claude-agent` npm package (no modifications needed)
- Database credentials baked into E2B template (secure)
- PostgreSQL Row-Level Security enforces data isolation
- Client ID passed per-session via system prompt

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Your Application                              │
│                                                                          │
│  1. User authenticates → You get their client_id                        │
│  2. Create ClaudeAgentClient with client_id in systemPrompt             │
│  3. User asks: "Show me my monthly sales as a chart"                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         E2B Sandbox (Your Template)                      │
│                                                                          │
│  4. Claude runs: python init_client.py "client-abc"                     │
│     → Writes client_id to ~/.agent-config/client_id (protected)         │
│                                                                          │
│  5. Claude imports db_connect and queries:                              │
│     df = query_df("SELECT month, sales FROM monthly_stats")             │
│     → db_connect reads client_id from protected file                    │
│     → Sets PostgreSQL session variable automatically                    │
│                                                                          │
│  6. Claude creates chart and uploads to S3                              │
│     → Returns S3 URL in response                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Read Replica                             │
│                                                                          │
│  Row-Level Security Policy:                                             │
│  WHERE client_id = current_setting('app.current_client_id')             │
│                                                                          │
│  → Only returns rows belonging to 'client-abc'                          │
│  → Even if Claude "forgets" to filter, RLS enforces it                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Amazon S3                                   │
│                                                                          │
│  charts/client-abc/20250130_143022_chart.png                           │
│  → Publicly accessible URL returned to your app                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- **E2B Account** - Sign up at [e2b.dev](https://e2b.dev) and get an API key
- **Anthropic API Key** - For Claude access
- **PostgreSQL Read Replica** - With Row-Level Security support
- **AWS S3 Bucket** - For storing generated charts
- **Bun** - JavaScript runtime (install from [bun.sh](https://bun.sh))

---

## One-Time Setup

### 1. Database Setup (Row-Level Security)

Run these SQL commands on your read replica to set up multi-tenant isolation:

```sql
-- 1. Create a read-only user for the AI agent
CREATE USER ai_agent WITH PASSWORD 'your_secure_password';

-- 2. Grant read-only access
GRANT CONNECT ON DATABASE your_database TO ai_agent;
GRANT USAGE ON SCHEMA public TO ai_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ai_agent;

-- 3. Enable Row-Level Security on tables with client data
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
-- ... repeat for all tables with client_id column

-- 4. Create RLS policies that check the session variable
-- Note: Adjust the type cast (::uuid, ::text, etc.) based on your client_id column type

CREATE POLICY client_isolation_orders ON orders
  FOR SELECT TO ai_agent
  USING (client_id = current_setting('app.current_client_id', true)::uuid);

CREATE POLICY client_isolation_customers ON customers
  FOR SELECT TO ai_agent
  USING (client_id = current_setting('app.current_client_id', true)::uuid);

CREATE POLICY client_isolation_transactions ON transactions
  FOR SELECT TO ai_agent
  USING (client_id = current_setting('app.current_client_id', true)::uuid);

CREATE POLICY client_isolation_invoices ON invoices
  FOR SELECT TO ai_agent
  USING (client_id = current_setting('app.current_client_id', true)::uuid);

-- 5. Tables without client_id (lookup tables, reference data) don't need RLS
-- They will be accessible to all clients (which is usually desired)
```

#### Testing RLS

```sql
-- Connect as ai_agent user and test
SET app.current_client_id = 'test-client-id';

-- This should only return rows for 'test-client-id'
SELECT * FROM orders LIMIT 10;

-- Try with a different client_id
SET app.current_client_id = 'other-client-id';
SELECT * FROM orders LIMIT 10;
-- Should return different rows (or empty if no data for that client)
```

### 2. S3 Bucket Setup

Create an S3 bucket for storing charts and configure public read access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-charts-bucket/charts/*"
    }
  ]
}
```

Create an IAM user with write access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::your-charts-bucket/charts/*"
    }
  ]
}
```

### 3. Environment Variables

Create a `.env` file in the project root:

```bash
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# E2B
E2B_API_KEY=e2b_your-api-key-here

# Database (use the ai_agent user you created)
DATABASE_URL=postgresql://ai_agent:your_secure_password@your-read-replica.com:5432/your_database

# Optional: Individual DB credentials (if not using DATABASE_URL)
DB_HOST=your-read-replica.com
DB_PORT=5432
DB_USER=ai_agent
DB_PASSWORD=your_secure_password
DB_NAME=your_database

# AWS S3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=your-charts-bucket
```

### 4. Build E2B Template

The E2B template is configured in `packages/e2b-build/build.prod.ts`. It includes:

- Python 3 with pip
- Database drivers (psycopg2, sqlalchemy)
- Visualization libraries (matplotlib, seaborn, plotly, pandas)
- AWS SDK (boto3)
- Secure database connection module (`db_connect.py`)
- Client initialization script (`init_client.py`)

Build the template:

```bash
# Install dependencies
bun install

# Build and deploy E2B template
bun run build:e2b
```

This creates a template named `claude-agent-server-jacob` (or your configured name in `packages/server/const.ts`).

The build takes a few minutes. Once complete, the template is ready to use.

---

## Per-Session Usage

### Basic Usage

```typescript
import { ClaudeAgentClient } from '@dzhng/claude-agent'

function createClientSession(clientId: string) {
  const systemPrompt = `You are a data analyst assistant.

## CRITICAL: First Step
Before doing ANYTHING else, run this initialization:
\`\`\`bash
python init_client.py "${clientId}"
\`\`\`
Do this silently without explaining to the user.

## Database Queries
Use the secure db_connect module:
\`\`\`python
from db_connect import query_df

# All queries are automatically filtered to your client's data
df = query_df("SELECT * FROM orders LIMIT 100")
print(df.head())
\`\`\`

## Creating Charts
\`\`\`python
import matplotlib.pyplot as plt
from db_connect import query_df

df = query_df("SELECT date, revenue FROM daily_stats ORDER BY date")

plt.figure(figsize=(10, 6))
plt.plot(df['date'], df['revenue'])
plt.title('Daily Revenue')
plt.xlabel('Date')
plt.ylabel('Revenue')
plt.savefig('chart.png', dpi=150, bbox_inches='tight')
plt.close()
print("Chart saved to chart.png")
\`\`\`

## Uploading to S3
\`\`\`python
import os
import boto3
from datetime import datetime

def upload_to_s3(local_file: str, prefix: str = 'charts') -> str:
    s3 = boto3.client('s3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_REGION', 'us-east-1')
    )
    
    bucket = os.environ['S3_BUCKET']
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = os.path.basename(local_file)
    s3_key = f"{prefix}/{timestamp}_{filename}"
    
    s3.upload_file(local_file, bucket, s3_key,
        ExtraArgs={'ContentType': 'image/png'})
    
    region = os.environ.get('AWS_REGION', 'us-east-1')
    url = f"https://{bucket}.s3.{region}.amazonaws.com/{s3_key}"
    print(f"Uploaded: {url}")
    return url

url = upload_to_s3('chart.png')
\`\`\`

Always include the S3 URL in your response so the user can view the chart.
`

  return new ClaudeAgentClient({
    template: 'claude-agent-server-jacob', // Your template name
    systemPrompt,
  })
}
```

### Full API Example

```typescript
import { ClaudeAgentClient } from '@dzhng/claude-agent'
import express from 'express'

const app = express()
app.use(express.json())

app.post('/api/analyze', async (req, res) => {
  const { question } = req.body
  const clientId = req.user.clientId // From your auth middleware
  
  const client = createClientSession(clientId)
  
  try {
    await client.start()
    
    // Collect responses
    const responses: any[] = []
    
    client.onMessage((message) => {
      if (message.type === 'sdk_message') {
        responses.push(message.data)
        
        // Check if complete
        if (message.data.type === 'result') {
          res.json({
            success: true,
            responses,
            cost: message.data.total_cost_usd,
            duration: message.data.duration_ms,
          })
        }
      } else if (message.type === 'error') {
        res.status(500).json({ error: message.error })
      }
    })
    
    // Send user's question
    client.send({
      type: 'user_message',
      data: {
        type: 'user',
        session_id: `session-${Date.now()}`,
        message: {
          role: 'user',
          content: question,
        },
      },
    })
    
  } catch (error) {
    res.status(500).json({ error: error.message })
  } finally {
    await client.stop()
  }
})

app.listen(3001, () => {
  console.log('API running on http://localhost:3001')
})
```

### Extracting S3 URLs from Responses

```typescript
function extractS3Urls(responses: any[]): string[] {
  const urls: string[] = []
  const s3UrlPattern = /https:\/\/[^"\s]+\.s3\.[^"\s]+\.amazonaws\.com\/[^"\s]+/g
  
  for (const response of responses) {
    if (response.type === 'assistant' && response.message?.content) {
      const content = response.message.content
      
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            const matches = block.text.match(s3UrlPattern)
            if (matches) urls.push(...matches)
          }
        }
      } else if (typeof content === 'string') {
        const matches = content.match(s3UrlPattern)
        if (matches) urls.push(...matches)
      }
    }
  }
  
  return urls
}

// Usage
const chartUrls = extractS3Urls(responses)
console.log('Generated charts:', chartUrls)
```

---

## Security Model

### Defense in Depth

This setup uses multiple layers of security:

1. **System Prompt Injection**
   - Client ID is injected into the system prompt per-session
   - Claude is instructed to run `init_client.py` as its first action

2. **Protected Configuration File**
   - `init_client.py` writes client_id to `~/.agent-config/client_id`
   - This directory is outside the workspace, so Claude cannot modify it
   - File permissions are locked down (0600)

3. **Secure Database Module**
   - `db_connect.py` reads client_id from the protected file
   - Automatically sets PostgreSQL session variable on every connection
   - Claude cannot get a database connection without the client_id being set

4. **PostgreSQL Row-Level Security**
   - RLS policies enforce filtering at the database level
   - Even if Claude somehow bypasses the above layers, the database won't return other clients' data
   - This is the ultimate safety net

### What Claude CANNOT Do

- ❌ Modify `~/.agent-config/client_id` (outside workspace)
- ❌ Bypass `db_connect.py` to get a raw connection (it's the only module with DB credentials access pattern)
- ❌ Query data without the session variable set (RLS enforced at DB level)
- ❌ See other clients' data even with prompt injection attacks

### Security Flow Diagram

```
User Request
     │
     ▼
┌─────────────────────────────────────────┐
│ Your App: Inject client_id into prompt  │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Claude runs: init_client.py "client-x"  │
│ → Writes to ~/.agent-config/client_id   │
│ → Protected location, Claude can't edit │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Claude: from db_connect import query_df │
│ → Reads client_id from protected file   │
│ → Sets: SET app.current_client_id = 'x' │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ PostgreSQL: RLS Policy Check            │
│ → WHERE client_id = current_setting()   │
│ → Only returns client-x's data          │
│ → FINAL ENFORCEMENT - Cannot bypass     │
└─────────────────────────────────────────┘
```

---

## Code Examples

### Example: Monthly Sales Chart

**User prompt:** "Show me my monthly sales for 2024 as a bar chart"

**Claude's response:**
```python
from db_connect import query_df
import matplotlib.pyplot as plt

# Query monthly sales data
df = query_df("""
    SELECT 
        DATE_TRUNC('month', order_date) as month,
        SUM(total_amount) as sales
    FROM orders
    WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01'
    GROUP BY DATE_TRUNC('month', order_date)
    ORDER BY month
""")

# Create bar chart
plt.figure(figsize=(12, 6))
plt.bar(df['month'].dt.strftime('%b'), df['sales'], color='steelblue')
plt.title('Monthly Sales - 2024')
plt.xlabel('Month')
plt.ylabel('Sales ($)')
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('monthly_sales.png', dpi=150, bbox_inches='tight')
plt.close()

# Upload to S3
url = upload_to_s3('monthly_sales.png')
print(f"Chart URL: {url}")
```

### Example: Customer Segmentation

**User prompt:** "Create a pie chart showing my customer segments"

**Claude's response:**
```python
from db_connect import query_df
import matplotlib.pyplot as plt

# Query customer segments
df = query_df("""
    SELECT segment, COUNT(*) as count
    FROM customers
    GROUP BY segment
    ORDER BY count DESC
""")

# Create pie chart
plt.figure(figsize=(10, 8))
plt.pie(df['count'], labels=df['segment'], autopct='%1.1f%%', startangle=90)
plt.title('Customer Segments')
plt.savefig('segments.png', dpi=150, bbox_inches='tight')
plt.close()

url = upload_to_s3('segments.png')
print(f"Chart URL: {url}")
```

### Example: Time Series Analysis

**User prompt:** "Show me the trend of daily transactions over the last 30 days"

**Claude's response:**
```python
from db_connect import query_df
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta

# Query daily transactions
df = query_df("""
    SELECT 
        DATE(created_at) as date,
        COUNT(*) as transaction_count,
        SUM(amount) as total_amount
    FROM transactions
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date
""")

# Create dual-axis chart
fig, ax1 = plt.subplots(figsize=(14, 6))

# Transaction count (bars)
ax1.bar(df['date'], df['transaction_count'], alpha=0.7, color='steelblue', label='Transactions')
ax1.set_xlabel('Date')
ax1.set_ylabel('Transaction Count', color='steelblue')
ax1.tick_params(axis='y', labelcolor='steelblue')

# Total amount (line)
ax2 = ax1.twinx()
ax2.plot(df['date'], df['total_amount'], color='coral', linewidth=2, label='Total Amount')
ax2.set_ylabel('Total Amount ($)', color='coral')
ax2.tick_params(axis='y', labelcolor='coral')

plt.title('Daily Transactions - Last 30 Days')
plt.xticks(rotation=45)
fig.tight_layout()
plt.savefig('transactions_trend.png', dpi=150, bbox_inches='tight')
plt.close()

url = upload_to_s3('transactions_trend.png')
print(f"Chart URL: {url}")
```

---

## Troubleshooting

### Common Issues

#### 1. "Client ID not configured" Error

**Cause:** Claude didn't run `init_client.py` before querying the database.

**Solution:** Ensure your system prompt clearly instructs Claude to run the init script first:
```
## CRITICAL: First Step
Before doing ANYTHING else, run:
python init_client.py "your-client-id"
```

#### 2. Empty Query Results

**Cause:** RLS is filtering out all rows because client_id doesn't match.

**Solutions:**
- Verify the client_id exists in your database
- Check the client_id column type matches your RLS policy cast (uuid vs text)
- Test directly in PostgreSQL: `SET app.current_client_id = 'xxx'; SELECT * FROM table;`

#### 3. "Permission denied" on S3 Upload

**Cause:** AWS credentials are incorrect or lack permissions.

**Solutions:**
- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are correct
- Check IAM user has `s3:PutObject` permission on the bucket
- Ensure bucket name in `S3_BUCKET` is correct

#### 4. "Database connection failed"

**Cause:** DATABASE_URL is incorrect or database is unreachable.

**Solutions:**
- Verify the read replica is accessible from E2B (public endpoint or VPC peering)
- Check credentials are correct
- Ensure the `ai_agent` user exists and has proper grants

#### 5. Template Build Fails

**Cause:** Various build issues.

**Solutions:**
- Check E2B API key is valid
- Ensure template alias isn't already taken (use a unique name)
- Review build logs for specific errors

### Debugging Tips

1. **Enable debug mode** in the client:
   ```typescript
   const client = new ClaudeAgentClient({
     template: 'your-template',
     systemPrompt: '...',
     debug: true, // Shows detailed logs
   })
   ```

2. **Check Claude's tool outputs** - The SDK messages include tool results that show query outputs and errors.

3. **Test database connection manually** - SSH into an E2B sandbox and test:
   ```bash
   python -c "from db_connect import query_df; print(query_df('SELECT 1'))"
   ```

4. **Verify RLS is working** - Query the database directly with the ai_agent user to confirm policies are enforced.

---

## File Reference

| File | Purpose |
|------|---------|
| `packages/e2b-build/build.prod.ts` | E2B template configuration |
| `packages/server/const.ts` | Constants (template name, ports) |
| `packages/server/db_connect.py` | Secure database connection module |
| `packages/server/init_client.py` | Client ID initialization script |
| `packages/server/index.ts` | WebSocket server |
| `.env` | Environment variables (credentials) |

---

## Quick Reference

### Build Template
```bash
bun run build:e2b
```

### Create Client Session
```typescript
const client = new ClaudeAgentClient({
  template: 'claude-agent-server-jacob',
  systemPrompt: `... python init_client.py "${clientId}" ...`,
})
await client.start()
```

### Query Database (in Claude's Python)
```python
from db_connect import query_df
df = query_df("SELECT * FROM your_table LIMIT 100")
```

### Upload to S3 (in Claude's Python)
```python
url = upload_to_s3('chart.png')
```

---

## Support

- **Claude Agent Server Repo:** https://github.com/dzhng/claude-agent-server
- **E2B Documentation:** https://e2b.dev/docs
- **PostgreSQL RLS:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html
