// E2B build script

import { defaultBuildLogger, Template, waitForPort } from 'e2b'

import {
  E2B_CPU_COUNT,
  E2B_MEMORY_MB,
  E2B_TEMPLATE_ALIAS,
  SERVER_PORT,
  WORKSPACE_DIR_NAME,
} from '../server/const'

// Database credentials - loaded from .env at build time
// These get baked into the template and are available to all processes
const DATABASE_URL = process.env.DATABASE_URL || ''


// AWS credentials for S3 uploads
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || ''
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || ''
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const S3_BUCKET = process.env.S3_BUCKET || ''

const template = Template()
  .fromBunImage('1.3')
  .runCmd('pwd')
  .makeDir(`/home/user/${WORKSPACE_DIR_NAME}`)
  .runCmd('sudo apt install -y git python3 python3-pip python3-venv libpq-dev')
  // Database drivers
  .runCmd('pip3 install --break-system-packages psycopg2-binary pymysql sqlalchemy')
  // Data analysis & visualization
  .runCmd('pip3 install --break-system-packages pandas numpy matplotlib seaborn plotly')
  // AWS SDK for S3 uploads
  .runCmd('pip3 install --break-system-packages boto3')
  .skipCache()
  .gitClone('https://github.com/BuckyMcYolo/claude-agent-server', '/home/user/app', {
    branch: 'main',
  })
  .setWorkdir('/home/user/app')
  .runCmd('ls -la')
  .runCmd('bun install')
  // Copy db_connect.py to workspace so Claude can import it
  .runCmd(`cp /home/user/app/packages/server/db_connect.py /home/user/${WORKSPACE_DIR_NAME}/`)
  // Copy init_client.py and make it executable
  .runCmd(`cp /home/user/app/packages/server/init_client.py /home/user/${WORKSPACE_DIR_NAME}/`)
  .runCmd(`chmod +x /home/user/${WORKSPACE_DIR_NAME}/init_client.py`)
  // Bake environment variables into the template
  // These are available to all processes (Python, shell, etc.)
  .setEnvs({
    DATABASE_URL,
    // AWS credentials for S3 uploads
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
    S3_BUCKET,
    // Add workspace to Python path so db_connect is importable
    PYTHONPATH: `/home/user/${WORKSPACE_DIR_NAME}`,
  })
  .setStartCmd('bun run start:sandbox', waitForPort(SERVER_PORT))

async function main() {
  await Template.build(template, {
    alias: E2B_TEMPLATE_ALIAS,
    cpuCount: E2B_CPU_COUNT,
    memoryMB: E2B_MEMORY_MB,
    onBuildLogs: defaultBuildLogger(),
  })
}

main().catch(console.error)
