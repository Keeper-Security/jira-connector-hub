# Keeper for Jira

A powerful Atlassian Forge application that integrates Keeper Security's vault management platform with Jira Cloud. Manage credentials, secrets, and privileged access workflows directly from your Jira issues.

## Features

### Vault Operations from Jira Issues
- **Create New Secrets** - Add login credentials, secure notes, and other record types directly from Jira
- **Update Records** - Modify existing vault records including passwords, usernames, and custom fields
- **Share Records** - Grant or revoke user access to individual records with configurable permissions and expiration
- **Share Folders** - Manage folder-level access and permissions for users or teams
- **Record Permissions** - Control granular permissions within shared folders

### Keeper Endpoint Privilege Manager (KEPM)
- Automated ticket creation for Keeper Security KEPM alerts via webhooks
- Real-time approval workflows with **Approve/Deny** action buttons
- **Live countdown timer** showing time remaining before request expiration (30 minutes)
- Auto-detection of expired requests with automatic comment posting
- Duplicate webhook prevention using unique request UIDs
- Enriched ticket details with user context and justification messages
- Automatic ticket assignment to project administrators

### Centralized Configuration (Global Settings)
- API URL and API Key configuration with validation
- Built-in connection verification and status monitoring
- URL pattern validation (ngrok, Cloudflare tunnels, custom domains)

### Webhook Configuration
- Secure webhook endpoint for Keeper KEPM alerts
- **Token-based authentication** (`Authorization: Bearer <token>`)
- Token generation and revocation from UI
- Webhook audit logs (last 100 entries)
- Test webhook functionality with sample payloads
- View webhook-created tickets

### Rate Limiting
- **Keeper Commands**: 5 per minute, 50 per hour (per user)
- **Webhooks**: 50 per hour (per source IP)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Customer Infrastructure                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │  Keeper Vault   │◄───│ Commander CLI   │◄───│ ngrok/Cloudflare│  │
│  │  (Cloud/OnPrem) │    │ (Service Mode)  │    │ Tunnel          │  │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘  │
└─────────────────────────────────────────────────────────│───────────┘
                                                          │
                                                          │ HTTPS
                                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Atlassian Cloud                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   Jira Cloud    │◄───│  Keeper Forge   │───►│ Customer's      │  │
│  │   Instance      │    │  App            │    │ Tunnel URL      │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Requirements

### Jira Cloud
- Jira Cloud instance with appropriate admin permissions
- **Manage apps** permission for installation

### Keeper Security
- Keeper Enterprise account with Commander CLI access
- Commander CLI version 17.1.7 or later (for API v2 async queue support)
- Commander CLI running in Service Mode with queue enabled (`-q y`)

### Tunneling
- ngrok or Cloudflare Tunnel for exposing Commander API to Jira Cloud

## Installation

### 1. Install the Forge App

```bash
# Install dependencies (from keeper-jira-app directory)
cd keeper-jira-app
npm install

# Build the UI components
cd static/keeper-ui && npm install && npm run build && cd ../..
cd static/keeper-issue-ui && npm install && npm run build && cd ../..

# Deploy to Atlassian
forge deploy

# Install on your Jira instance
forge install
```

### 2. Set Up Keeper Commander CLI

```bash
# Install Commander CLI
pip install keepercommander

# Configure persistent login
keeper shell
login your@email.com
this-device persistent-login on
this-device register
this-device timeout 30d
```

### 3. Start Commander in Service Mode

**Basic Service (Local Development):**
```bash
keeper service-create \
  -p=9009 \
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,service-status" \
  -rm="foreground" \
  -q=y \
  -f=json
```

**With ngrok Tunneling (Built-in):**
```bash
keeper service-create \
  -p=9009 \
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,service-status" \
  -rm="foreground" \
  -q=y \
  -ng="<ngrok-auth-token>" \
  -cd="<custom-domain>" \
  -f=json
```

**With Cloudflare Tunneling (Built-in):**

> **Note:** Cloudflare tunnel flags (`-cf`, `-cfd`) require Keeper Commander CLI version 17.2.0 or later. Check your version with `keeper --version`.

```bash
keeper service-create \
  -p=9009 \
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,service-status" \
  -rm="foreground" \
  -q=y \
  -cf="<cloudflare-tunnel-token>" \
  -cfd="<cloudflare-custom-domain>" \
  -f=json
```

**Tunneling Parameters:**
| Flag | Description |
|------|-------------|
| `-ng` | ngrok auth token |
| `-cd` | ngrok custom domain (subdomain portion only) |
| `-cf` | Cloudflare tunnel token |
| `-cfd` | Cloudflare custom domain |

### 4. Configure the App

1. Navigate to **Jira Settings → Apps → Keeper**
2. Enter your Commander API URL (e.g., `https://your-tunnel.ngrok.io/api/v2`)
3. Enter your API Key (displayed when Commander starts)
4. Click **Test Connection** to verify
5. Click **Save Settings**

## API Configuration

This integration uses **Keeper Commander API v2** (async queue mode), which provides:
- Asynchronous command execution with queue support
- Polling-based result retrieval with exponential backoff
- Rate limiting and queue overflow handling

**Required Service Configuration:**

| Setting | Value |
|---------|-------|
| Commands List | `record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,service-status` |
| Queue System | `-q y` (Required for API v2) |
| Run Mode | `-rm foreground` |
| Output Format | `-f json` |

## Webhook Setup (KEPM Integration)

To receive KEPM approval requests from Keeper Security:

### 1. Configure Webhook Target

1. Navigate to **Jira Settings → Apps → Keeper → Webhook Configuration**
2. Select the **Target Project** where tickets will be created
3. Select the **Issue Type** for KEPM tickets
4. Click **Save Configuration**

### 2. Generate Authentication Token

1. Click **Generate Token** to create a secure webhook token
2. Copy the token (shown only once) or the full `Authorization` header
3. The webhook URL is displayed at the top of the configuration panel

### 3. Configure Keeper Security

In your Keeper Security admin console, configure the webhook with:

| Setting | Value |
|---------|-------|
| URL | The webhook URL from step 2 |
| Method | `POST` |
| Content-Type | `application/json` |
| Authorization Header | `Bearer <your-token>` |

**Example webhook request:**
```bash
curl -X POST "https://your-webhook-url" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "category": "endpoint_privilege_manager",
    "audit_event": "approval_request_created",
    "request_uid": "abc123..."
  }'
```

### Webhook Security Features

- **Token Authentication**: All requests must include valid `Authorization: Bearer <token>` header
- **Rate Limiting**: Maximum 50 requests per hour per source IP
- **Payload Validation**: Schema validation for KEPM events
- **Duplicate Prevention**: Requests with same `request_uid` return existing ticket instead of creating duplicates
- **Audit Logging**: Last 100 webhook attempts are logged for debugging

## Permissions

| Scope | Purpose |
|-------|---------|
| `read:jira-work` | Read issue details and project information |
| `write:jira-work` | Update issue fields and add comments |
| `storage:app` | Store app configuration securely |
| `read:jira-user` | Identify users for access control |

## Security

- **No credential storage**: Secrets are never stored in Atlassian infrastructure
- **Customer-controlled backend**: All sensitive operations occur in your environment
- **End-to-end encryption**: All communication uses HTTPS
- **Principle of least privilege**: Only necessary Jira scopes requested

## Development

### Project Structure

```
keeper-jira-app/
├── manifest.yml                  # Forge app manifest
├── src/
│   ├── index.js                  # Main resolver functions (34 resolvers)
│   └── modules/
│       ├── keeperApi.js          # Keeper API v2 integration with rate limiting
│       ├── webhookHandler.js     # KEPM webhook processing with security
│       └── utils/
│           ├── logger.js         # Simple logger with sensitive data redaction
│           ├── errorResponse.js  # Structured error responses
│           ├── jiraApiRetry.js   # Jira API retry with exponential backoff
│           ├── adfBuilder.js     # Atlassian Document Format builders
│           ├── labelBuilder.js   # Jira label generation
│           └── commandBuilder.js # Keeper CLI command construction
└── static/
    ├── keeper-ui/                # Global settings page (React)
    │   └── src/components/
    │       ├── config/           # ConfigForm, WebTriggerConfig, WebhookTicketsTable
    │       └── common/           # Loading, StatusMessage, TabBar
    └── keeper-issue-ui/          # Issue panel (React)
        └── src/components/
            ├── issue/            # ActionSelector, EpmApprovalPanel
            └── common/           # Dropdown, Loading, Modal, StatusMessage
```

### Building

```bash
# Build global page UI
cd static/keeper-ui && npm run build

# Build issue panel UI
cd static/keeper-issue-ui && npm run build

# Deploy changes
forge deploy
```

### Environment Commands

```bash
# Deploy to development
forge deploy

# Deploy to staging
forge deploy -e staging

# Deploy to production
forge deploy -e production
```

### Viewing Logs

```bash
# View recent logs
forge logs

# View logs with full details
forge logs --verbose

# View grouped logs (recommended)
forge logs --verbose --grouped

# Tail logs in real-time
forge logs -f
```

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Connection failed` | Tunnel not running or URL incorrect | Start ngrok/Cloudflare tunnel, verify API URL in settings |
| `Rate limit exceeded` | Too many commands in time window | Wait for rate limit to reset (shown in error message) |
| `Invalid authentication token` | Wrong or missing Bearer token | Regenerate token in Webhook Configuration |
| `Webhook not configured` | Missing project/issue type selection | Complete Webhook Configuration setup |
| `Queue is full` | Commander queue capacity reached | Wait for pending requests to complete |
| `Request expired` | KEPM approval request timed out | User must submit a new access request |

### Tunnel Troubleshooting

**ngrok:**
```bash
# Check ngrok status
curl https://your-subdomain.ngrok.io/api/v2/status

# Restart ngrok with same domain
ngrok http 9009 --domain=your-subdomain.ngrok.io
```

**Cloudflare:**
```bash
# Check tunnel status
cloudflared tunnel info <tunnel-name>

# Restart tunnel
cloudflared tunnel run <tunnel-name>
```

### Connection Issues

1. **Verify Commander is running**: Check that `keeper service-create` is active
2. **Test locally first**: `curl http://localhost:9009/api/v2/status` should return JSON
3. **Check tunnel logs**: Look for connection errors in ngrok/Cloudflare output
4. **Verify API URL format**: Must be `https://your-tunnel/api/v2` (include `/api/v2`)

## Documentation

- [Keeper Commander CLI Documentation](https://docs.keeper.io/en/keeperpam/commander-cli/overview)
- [Service Mode REST API](https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api)
- [API v2 Usage Guide](https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api/api-usage)
- [Atlassian Forge Platform](https://developer.atlassian.com/platform/forge/)

## Support

- **Technical Support**: commander@keepersecurity.com
- **Keeper Documentation**: [docs.keeper.io](https://docs.keeper.io)
- **Forge Documentation**: [developer.atlassian.com/platform/forge](https://developer.atlassian.com/platform/forge/)

## License

MIT License - See LICENSE file for details.
