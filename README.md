# Keeper Security for Jira Cloud

A powerful Atlassian Forge application that integrates Keeper Security's vault management platform with Jira Cloud. Manage credentials, secrets, and privileged access workflows directly from your Jira issues.

## Features

### Vault Operations from Jira Issues

- **Create New Secrets** - Add login credentials, secure notes, and other record types directly from Jira
- **Update Records** - Modify existing vault records including passwords, usernames, and custom fields
- **Share Records** - Grant or revoke user access to individual records with configurable permissions and expiration
- **Share Folders** - Manage folder-level access and permissions for users or teams
- **Record Permissions** - Control granular permissions within folders
- **Two permission models** - All five vault actions support both the **new shared folder** model and the **classic** model. The new shared folder model uses role-based access control (viewer, share-manager, content-manager, content-and-share-manager, full-manager). Toggle between models via the "Use classic permission model" checkbox in the issue panel

### Endpoint Privilege Manager (EPM)

- Approval workflows from the issue panel with **Approve/Deny** actions driven by Keeper Commander (`epm` commands)
- **Live countdown timer** showing time remaining before request expiration (30 minutes)
- Auto-detection of expired requests with automatic comment posting
- Enriched request details with user context and justification messages (via Commander)
- Automatic ticket assignment to project administrators

### Device approval (SSO / enterprise devices)

- Issue panel for tickets labeled by your ITSM flow (for example `ITSM_device_admin_approval_requested`), with **Approve** and **Deny** actions
- Uses Keeper Commander `**device-approve`** against the user or device identifier from the ticket payload (see [device-approve command](https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/enterprise-management-commands#device-approve-command))
- **No fixed expiry** in the panel (unlike EPM): requests stay actionable until approved or denied, or detected as already handled outside Jira
- Resolved state and **processed outside Jira** handling via issue labels (`device-approved`, `device-denied`) and audit comments, consistent with the EPM panel pattern

### Centralized Configuration (Global Settings)

- API URL and API Key configuration with validation
- Built-in connection verification and status monitoring
- URL pattern validation (ngrok, Cloudflare tunnels, custom domains)

### Rate Limiting

- **Read commands** (list, get, record-type-info): 30 per minute, 300 per hour (per user)
- **Write commands** (record-add, share-record, etc.): 5 per minute, 50 per hour (per user)

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
- Commander CLI version 18.0.0 or later (required for the new shared folder model; 17.1.7+ for classic-only)
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
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,device-approve,enterprise-info,ei,service-status,one-time-share,rm,sync-down,search,tree,cd,nsf-list,nsf-get,nsf-record-add,nsf-record-update,nsf-share-folder,nsf-share-record,nsf-record-permission" \
  -rm="foreground" \
  -q=y \
  -f=json
```

**With ngrok Tunneling (Built-in):**

```bash
keeper service-create \
  -p=9009 \
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,device-approve,enterprise-info,ei,service-status,one-time-share,rm,sync-down,search,tree,cd,nsf-list,nsf-get,nsf-record-add,nsf-record-update,nsf-share-folder,nsf-share-record,nsf-record-permission" \
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
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,epm,device-approve,enterprise-info,ei,service-status,one-time-share,rm,sync-down,search,tree,cd,nsf-list,nsf-get,nsf-record-add,nsf-record-update,nsf-share-folder,nsf-share-record,nsf-record-permission" \
  -rm="foreground" \
  -q=y \
  -cf="<cloudflare-tunnel-token>" \
  -cfd="<cloudflare-custom-domain>" \
  -f=json
```

**Tunneling Parameters:**


| Flag   | Description                                  |
| ------ | -------------------------------------------- |
| `-ng`  | ngrok auth token                             |
| `-cd`  | ngrok custom domain (subdomain portion only) |
| `-cf`  | Cloudflare tunnel token                      |
| `-cfd` | Cloudflare custom domain                     |


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


| Setting       | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| Commands List | See the full `-c` allowlist in the service-create examples above |
| Queue System  | `-q y` (Required for API v2)                                     |
| Run Mode      | `-rm foreground`                                                 |
| Output Format | `-f json`                                                        |


## Permissions


| Scope             | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `read:jira-work`  | Read issue details and project information |
| `write:jira-work` | Update issue fields and add comments       |
| `storage:app`     | Store app configuration securely           |
| `read:jira-user`  | Identify users for access control          |


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
│   ├── index.js                  # Forge resolvers (global + issue panel)
│   └── modules/
│       ├── keeperApi.js          # Keeper API v2 integration with read/write rate limiting
│       └── utils/
│           ├── logger.js         # Logger with sensitive data redaction
│           ├── errorResponse.js  # Structured error responses
│           ├── jiraApiRetry.js   # Jira API retry with exponential backoff
│           ├── commandBuilder.js # Keeper CLI command construction
│           ├── nsfParser.js       # Shared folder list parsing (folders + records)
│           └── nsfShareCommands.js # Shared folder share/permission command builders
├── tests/
│   ├── unit/                     # commandBuilder, nsfParser, nsfShareCommands, errorResponse
│   ├── integration/              # webhookStatusChange
│   └── security/                 # injectionPayloads
└── static/
    ├── keeper-ui/                # Global settings page (React)
    │   └── src/components/
    │       ├── config/           # ConfigTab, ConfigForm
    │       └── common/           # Loading, StatusMessage, TabBar
    └── keeper-issue-ui/          # Issue panel (React)
        └── src/
            ├── IssuePanel.js     # Main issue panel component
            ├── constants/        # Action definitions, shared folder roles, pagination
            ├── services/         # api.js (Forge invoke wrappers)
            ├── utils/            # errorHandler, formatters, validators
            ├── styles/           # IssuePanel.css and component styles
            └── components/
                └── issue/        # ActionSelector, EpmApprovalPanel, DeviceApprovalPanel,
                                  # FormField, RequirementsBlock, SearchHint,
                                  # SelectedItemChip, LoadingPlaceholder,PaginationFooter
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


| Error                               | Cause                                                           | Solution                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Connection failed`                 | Tunnel not running or URL incorrect                             | Start ngrok/Cloudflare tunnel, verify API URL in settings                                                 |
| `Rate limit exceeded`               | Too many commands in time window                                | Wait for rate limit to reset (shown in error message)                                                     |
| `Queue is full`                     | Commander queue capacity reached                                | Wait for pending requests to complete                                                                     |
| `Request expired`                   | EPM approval request timed out                                  | User must submit a new access request                                                                     |
| `Shared folder not available (403)` | Missing `nsf-*` verbs on service allowlist or Commander < 18.0.0 | Add all `nsf-*` commands to the `-c` allowlist (see service-create examples), upgrade Commander to 18.0.0+ |


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

- [Jira Workflow Documentation](https://docs.keeper.io/en/keeperpam/secrets-manager/integrations/jira-workflow)
- [Keeper Commander CLI Documentation](https://docs.keeper.io/en/keeperpam/commander-cli/overview)
- [Service Mode REST API](https://docs.keeper.io/en/keeperpam/commander-cli/service-mode-rest-api)
- [Atlassian Forge Platform](https://developer.atlassian.com/platform/forge/)

## Support

Please open a Github issue or contact Keeper [customer support](https://www.keepersecurity.com/support.html)