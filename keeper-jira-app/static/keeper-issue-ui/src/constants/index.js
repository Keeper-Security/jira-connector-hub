// NSF role options. Server-side peer: NSF_ROLES in src/modules/utils/nsfShareCommands.js
// Source: https://docs.keeper.io/en/keeperpam/commander-cli/command-reference/nsf-commands
export const NSF_ROLES = [
  { value: 'viewer',                label: 'Viewer',                    description: 'Can view content and participants' },
  { value: 'share-manager',         label: 'Share Manager',             description: 'Can manage share permissions, invite others, and approve requests' },
  { value: 'content-manager',       label: 'Content Manager',           description: 'Can manage content' },
  { value: 'content-share-manager', label: 'Content and Share Manager', description: 'Can manage content and manage share permissions' },
  { value: 'full-manager',          label: 'Full Manager',              description: 'Edit, share and manage ownership' }
];

// Keeper action options with required fields based on CLI documentation
export const KEEPER_ACTION_OPTIONS = [
  { 
    value: 'record-add', 
    label: 'Create New Secret', 
    description: 'Create a new secret record in Keeper.',
    fields: [
      { name: 'folder', label: 'Select Folder', type: 'folder-select', required: false, placeholder: 'Select folder (optional — root if empty)' },
      { name: 'recordType', label: 'Record Type', type: 'select', required: true, options: [], placeholder: 'Select record type' }
    ]
  },
  { 
    value: 'record-update', 
    label: 'Update Record',
    description: 'Update existing record fields. Only fill in the fields you want to change.',
    fields: [
      { name: 'record', label: 'Record ID/Title', type: 'text', required: true, placeholder: 'Record ID or title to update' },
      { name: 'title', label: 'Title', type: 'text', required: false, placeholder: 'Title' },
      { name: 'recordType', label: 'Record Type', type: 'select', required: false, options: [], placeholder: 'Record Type' },
      { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
      { name: 'password', label: 'Password', type: 'text', required: false, placeholder: 'Password' },
      { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'URL' },
      { name: 'email', label: 'Email', type: 'email', required: false, placeholder: 'Email' },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Notes' },
      { name: 'force', label: 'Force Update', type: 'checkbox', required: false, description: 'Ignore warnings and force the update' }
    ]
  },
  { 
    value: 'record-permission', 
    label: 'Update Record Permissions in Folder', 
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'sharedFolder', label: 'Shared Folder', type: 'folder-select', required: true, placeholder: 'Select shared folder' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke'], placeholder: 'Select action' },
      { name: 'can_share', label: 'Can Share Records', type: 'checkbox', required: false, description: 'Allow sharing records' },
      { name: 'can_edit', label: 'Can Edit Records', type: 'checkbox', required: false, description: 'Allow modifying records in the folder' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply permission changes to all sub folders' }
    ]
  },
  { 
    value: 'share-record', 
    label: 'Request Access to Record', 
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'user', label: 'Email', type: 'email', required: true, placeholder: 'Email of account to edit permissions for' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke', 'owner', 'cancel'], placeholder: 'Select action' },
      { name: 'sharedFolder', label: 'Record Folder', type: 'folder-select', required: false, placeholder: 'Select record folder (optional for cancel action)' },
      { name: 'can_share', label: 'Allow Sharing', type: 'checkbox', required: false, description: 'Allow user to share record' },
      { name: 'can_write', label: 'Allow Writing', type: 'checkbox', required: false, description: 'Allow user to modify record' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply to all records in folder and subfolders (only for shared folder selection)' },
      { name: 'expiration_type', label: 'Expiration', type: 'select', required: false, options: ['none', 'expire-at', 'expire-in'], placeholder: 'Select expiration type', description: 'Set when the share access expires' },
      { name: 'expire_at', label: 'Expire At', type: 'datetime-local', required: false, placeholder: 'yyyy-MM-dd hh:mm:ss', description: 'Specific date and time when share expires', conditionalOn: 'expiration_type', conditionalValue: 'expire-at' },
      { name: 'expire_in', label: 'Expire In', type: 'text', required: false, placeholder: 'e.g., 5mi, 2h, 1d, 1mo, 1y', description: 'Duration until expiration (mi=minutes, h=hours, d=days, mo=months, y=years)', conditionalOn: 'expiration_type', conditionalValue: 'expire-in' }
    ]
  },
  { 
    value: 'share-folder', 
    label: 'Request Access to Folder', 
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'folder', label: 'Shared Folder', type: 'folder-select', required: true, placeholder: 'Select shared folder' },
      { name: 'user', label: 'Email/Team', type: 'text', required: true, placeholder: 'Email, team name, or * for all' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'remove'], placeholder: 'Select action' },
      { name: 'manage_records', label: 'Can Manage Records', type: 'checkbox', required: false, description: 'Allow user to manage records in folder' },
      { name: 'manage_users', label: 'Can Manage Users', type: 'checkbox', required: false, description: 'Allow user to manage other users access' },
      { name: 'can_share', label: 'Can Share Records', type: 'checkbox', required: false, description: 'Allow user to share records (records only)' },
      { name: 'can_edit', label: 'Can Edit Records', type: 'checkbox', required: false, description: 'Allow user to modify records (records only)' },
      { name: 'expiration_type', label: 'Expiration', type: 'select', required: false, options: ['none', 'expire-at', 'expire-in'], placeholder: 'Select expiration type', description: 'Set when the share access expires' },
      { name: 'expire_at', label: 'Expire At', type: 'datetime-local', required: false, placeholder: 'yyyy-MM-dd hh:mm:ss', description: 'Specific date and time when share expires', conditionalOn: 'expiration_type', conditionalValue: 'expire-at' },
      { name: 'expire_in', label: 'Expire In', type: 'text', required: false, placeholder: 'e.g., 5mi, 2h, 1d, 1mo, 1y', description: 'Duration until expiration (mi=minutes, h=hours, d=days, mo=months, y=years)', conditionalOn: 'expiration_type', conditionalValue: 'expire-in' }
    ]
  }
];

// NSF action overrides — only actions whose fields differ from Classic.
// Merged via getKeeperActionOptions() in IssuePanel.js.
export const KEEPER_ACTION_OPTIONS_NSF = [
  {
    // NSF: folder is optional for nsf-record-add (record is created at root if omitted).
    value: 'record-add',
    label: 'Create New Secret',
    description: 'Create a new secret record in Keeper.',
    fields: [
      { name: 'folder', label: 'Select Folder', type: 'folder-select', required: false, placeholder: 'Select folder (optional — root if empty)' },
      { name: 'recordType', label: 'Record Type', type: 'select', required: true, options: [], placeholder: 'Select record type' }
    ]
  },
  {
    // Same shape as Classic; NSF routing handled in commandBuilder.
    value: 'record-update',
    label: 'Update Record',
    description: 'Update existing record fields. Only fill in the fields you want to change.',
    fields: [
      { name: 'record', label: 'Record ID/Title', type: 'text', required: true, placeholder: 'Record ID or title to update' },
      { name: 'title', label: 'Title', type: 'text', required: false, placeholder: 'Title' },
      { name: 'recordType', label: 'Record Type', type: 'select', required: false, options: [], placeholder: 'Record Type' },
      { name: 'login', label: 'Login', type: 'text', required: false, placeholder: 'Username' },
      { name: 'password', label: 'Password', type: 'text', required: false, placeholder: 'Password' },
      { name: 'url', label: 'URL', type: 'url', required: false, placeholder: 'URL' },
      { name: 'email', label: 'Email', type: 'email', required: false, placeholder: 'Email' },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Notes' },
      { name: 'force', label: 'Force Update', type: 'checkbox', required: false, description: 'Ignore warnings and force the update' }
    ]
  },
  {
    // NSF: uses --role instead of Classic permission-flag checkboxes.
    value: 'record-permission',
    label: 'Update Record Permissions in Folder',
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'sharedFolder', label: 'Select Folder', type: 'folder-select', required: true, placeholder: 'Select folder' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke'], placeholder: 'Select action' },
      { name: 'role', label: 'Role', type: 'role', required: false, options: NSF_ROLES, placeholder: 'Select role', description: 'Required when action is grant; for revoke, optionally filter by role' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply permission changes to all sub-folders' }
    ]
  },
  {
    // NSF: action set is grant | revoke | owner (no cancel).
    value: 'share-record',
    label: 'Request Access to Record',
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'user', label: 'Email', type: 'email', required: true, placeholder: 'Email of account to share with' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'revoke', 'owner'], placeholder: 'Select action' },
      { name: 'sharedFolder', label: 'Record Folder', type: 'folder-select', required: false, placeholder: 'Select folder (optional, share all records in folder)' },
      { name: 'role', label: 'Role', type: 'role', required: false, options: NSF_ROLES, placeholder: 'Select role', description: 'Required when action is grant. Ignored for revoke and owner transfers.' },
      { name: 'recursive', label: 'Apply Recursively', type: 'checkbox', required: false, description: 'Apply to all records in folder and sub-folders' },
      { name: 'expiration_type', label: 'Expiration', type: 'select', required: false, options: ['none', 'expire-at', 'expire-in'], placeholder: 'Select expiration type', description: 'Set when the share access expires' },
      { name: 'expire_at', label: 'Expire At', type: 'datetime-local', required: false, placeholder: 'yyyy-MM-dd hh:mm:ss', description: 'Specific date and time when share expires', conditionalOn: 'expiration_type', conditionalValue: 'expire-at' },
      { name: 'expire_in', label: 'Expire In', type: 'text', required: false, placeholder: 'e.g., 5mi, 2h, 1d, 1mo, 1y', description: 'Duration until expiration (mi=minutes, h=hours, d=days, mo=months, y=years)', conditionalOn: 'expiration_type', conditionalValue: 'expire-in' }
    ]
  },
  {
    // NSF: action set is grant | remove (matches Classic).
    value: 'share-folder',
    label: 'Request Access to Folder',
    requiresSharedFolderSelection: true,
    fields: [
      { name: 'folder', label: 'Select Folder', type: 'folder-select', required: true, placeholder: 'Select folder' },
      { name: 'user', label: 'Email/Team', type: 'text', required: true, placeholder: 'Email, team name, or team UID' },
      { name: 'action', label: 'Action', type: 'select', required: true, options: ['grant', 'remove'], placeholder: 'Select action' },
      { name: 'role', label: 'Role', type: 'role', required: false, options: NSF_ROLES, placeholder: 'Select role', description: 'Required when action is grant.' },
      { name: 'expiration_type', label: 'Expiration', type: 'select', required: false, options: ['none', 'expire-at', 'expire-in'], placeholder: 'Select expiration type', description: 'Set when the share access expires' },
      { name: 'expire_at', label: 'Expire At', type: 'datetime-local', required: false, placeholder: 'yyyy-MM-dd hh:mm:ss', description: 'Specific date and time when share expires', conditionalOn: 'expiration_type', conditionalValue: 'expire-at' },
      { name: 'expire_in', label: 'Expire In', type: 'text', required: false, placeholder: 'e.g., 5mi, 2h, 1d, 1mo, 1y', description: 'Duration until expiration (mi=minutes, h=hours, d=days, mo=months, y=years)', conditionalOn: 'expiration_type', conditionalValue: 'expire-in' }
    ]
  }
];

// Pagination settings
export const PAGINATION_SETTINGS = {
  ITEMS_PER_PAGE: 5,
  RECORDS_PER_PAGE: 5,
  FOLDERS_PER_PAGE: 5
};