# Keeper for Jira

A powerful Atlassian Forge application that integrates Keeper Security's vault management platform with Jira Cloud. Manage credentials, secrets, and privileged access workflows directly from your Jira issues.

## Features

### Vault Operations from Jira Issues
- **Create New Secrets** - Add login credentials, secure notes, and other record types directly from Jira
- **Update Records** - Modify existing vault records including passwords, usernames, and custom fields
- **Share Records** - Grant or revoke user access to individual records with configurable permissions
- **Share Folders** - Manage folder-level access and permissions for users or teams
- **Record Permissions** - Control granular permissions within shared folders

### Endpoint Privilege Management (PEDM)
- Automated ticket creation for Keeper Security PEDM alerts via webhooks
- Real-time approval workflows with Approve/Deny action buttons
- Live countdown timers for time-sensitive approval requests
- Enriched ticket details with user context and justification messages

### Centralized Configuration
- Global settings page for API configuration
- Built-in connection verification and status monitoring
- Web trigger configuration for PEDM webhook integration

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
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" \
  -rm="foreground" \
  -q=y \
  -f=json
```

**With ngrok Tunneling (Built-in):**
```bash
keeper service-create \
  -p=9009 \
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" \
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
  -c="record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status" \
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
| Commands List | `record-add,list,ls,get,record-type-info,record-update,share-record,share-folder,rti,record-permission,pedm,service-status` |
| Queue System | `-q y` (Required for API v2) |
| Run Mode | `-rm foreground` |
| Output Format | `-f json` |

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
├── manifest.yml              # Forge app manifest
├── src/
│   ├── index.js              # Main resolver functions
│   └── modules/
│       ├── keeperApi.js      # Keeper API v2 integration
│       ├── webhookHandler.js # PEDM webhook processing
│       └── utils/            # Utility functions
└── static/
    ├── keeper-ui/            # Global page React app
    └── keeper-issue-ui/      # Issue panel React app
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
