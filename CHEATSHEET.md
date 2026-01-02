# Claude Agent Server - Quick Reference Cheatsheet

## Setup Commands

```bash
# Install dependencies
bun install

# Build E2B template (one-time, or after changes)
bun run build:e2b

# Start server locally (for development)
bun run start:server

# Test with E2B
bun run test:client
```

---

## Environment Variables (`.env`)

```bash
ANTHROPIC_API_KEY=sk-ant-...
E2B_API_KEY=e2b_...
DATABASE_URL=postgresql://ai_agent:password@read-replica.com:5432/mydb
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=my-charts-bucket
```

---

## Client Usage

```typescript
import { ClaudeAgentClient } from '@dzhng/claude-agent'

const client = new ClaudeAgentClient({
  template: 'claude-agent-server-jacob',
  systemPrompt: `You are a data analyst.

## First Step (REQUIRED)
\`\`\`bash
python init_client.py "${clientId}"
\`\`\`

## Database Queries
\`\`\`python
from db_connect import query_df
df = query_df("SELECT * FROM orders LIMIT 100")
\`\`\`

## Upload Charts
\`\`\`python
url = upload_to_s3('chart.png')
\`\`\`
`,
})

await client.start()

client.onMessage((msg) => {
  if (msg.type === 'sdk_message') {
    console.log(msg.data)
  }
})

client.send({
  type: 'user_message',
  data: {
    type: 'user',
    session_id: 'session-1',
    message: { role: 'user', content: 'Show me my sales data' },
  },
})

await client.stop()
```

---

## PostgreSQL RLS Setup

```sql
-- Create read-only user
CREATE USER ai_agent WITH PASSWORD 'secure_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_agent;

-- Enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY client_isolation ON orders
  FOR SELECT TO ai_agent
  USING (client_id = current_setting('app.current_client_id', true)::uuid);
```

---

## Python Snippets (for Claude's use)

### Query Database
```python
from db_connect import query_df

df = query_df("SELECT * FROM orders LIMIT 100")
print(df.head())
```

### Create Chart
```python
import matplotlib.pyplot as plt
from db_connect import query_df

df = query_df("SELECT date, revenue FROM daily_stats ORDER BY date")

plt.figure(figsize=(10, 6))
plt.plot(df['date'], df['revenue'])
plt.title('Daily Revenue')
plt.savefig('chart.png', dpi=150, bbox_inches='tight')
plt.close()
```

### Upload to S3
```python
import os
import boto3
from datetime import datetime

def upload_to_s3(local_file, prefix='charts'):
    s3 = boto3.client('s3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    
    bucket = os.environ['S3_BUCKET']
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    s3_key = f"{prefix}/{timestamp}_{os.path.basename(local_file)}"
    
    s3.upload_file(local_file, bucket, s3_key, ExtraArgs={'ContentType': 'image/png'})
    
    url = f"https://{bucket}.s3.{os.environ.get('AWS_REGION', 'us-east-1')}.amazonaws.com/{s3_key}"
    print(f"Uploaded: {url}")
    return url

url = upload_to_s3('chart.png')
```

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/e2b-build/build.prod.ts` | E2B template config |
| `packages/server/const.ts` | Template name, ports |
| `packages/server/db_connect.py` | Secure DB connection |
| `packages/server/init_client.py` | Client ID init |
| `.env` | Credentials |

---

## Security Flow

```
Your App                    E2B Sandbox                 PostgreSQL
────────                    ───────────                 ──────────
clientId in prompt  ──►  init_client.py writes     
                         ~/.agent-config/client_id
                                   │
                         db_connect.py reads it
                                   │
                         SET app.current_client_id  ──►  RLS Policy:
                                                         WHERE client_id = 
                                                         current_setting(...)
                                                               │
                                                         Only returns
                                                         client's data
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Client ID not configured" | Claude didn't run `init_client.py` first |
| Empty query results | Check client_id exists, verify RLS policy |
| S3 upload fails | Check AWS credentials and bucket permissions |
| DB connection fails | Verify DATABASE_URL and network access |
| Template build fails | Check E2B API key, use unique template name |

---

## Links

- [Full Guide](./GUIDE-DATABASE-VISUALIZATION.md)
- [Claude Agent Server](https://github.com/dzhng/claude-agent-server)
- [E2B Docs](https://e2b.dev/docs)
- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
