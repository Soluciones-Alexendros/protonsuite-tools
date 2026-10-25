# MCP Tool Contract — Proton Suite Agent

> Auto-generated from the Zod schemas declared in `src/server/*.ts` via `scripts/generate-docs.mjs`. Do not edit by hand — run `pnpm build && pnpm docs:generate`. Version: 1.4.3.

Total tools: **50**.

Tools are grouped by product domain. Each tool declares `inputSchema`
(validated by Zod) and `annotations` (readOnly/destructive/idempotent/openWorld
hints) so MCP clients can reason about effects before invoking.

## Table of contents

### Mail
- [`proton_list_folders`](#protonlistfolders)
- [`proton_create_folder`](#protoncreatefolder)
- [`proton_mailbox_status`](#protonmailboxstatus)
- [`proton_list_emails`](#protonlistemails)
- [`proton_search_emails`](#protonsearchemails)
- [`proton_get_email`](#protongetemail)
- [`proton_get_attachment`](#protongetattachment)
- [`proton_send_email`](#protonsendemail)
- [`proton_reply_email`](#protonreplyemail)
- [`proton_forward_email`](#protonforwardemail)
- [`proton_flag_email`](#protonflagemail)
- [`proton_move_email`](#protonmoveemail)
- [`proton_delete_email`](#protondeleteemail)

### Pass
- [`proton_pass_list`](#protonpasslist)
- [`proton_pass_get`](#protonpassget)
- [`proton_pass_generate`](#protonpassgenerate)
- [`proton_pass_health`](#protonpasshealth)
- [`proton_pass_insert`](#protonpassinsert)
- [`proton_pass_remove`](#protonpassremove)
- [`proton_pass_move`](#protonpassmove)
- [`proton_pass_copy`](#protonpasscopy)

### Calendar
- [`proton_calendar_list_events`](#protoncalendarlistevents)
- [`proton_calendar_create_event`](#protoncalendarcreateevent)
- [`proton_calendar_list_calendars`](#protoncalendarlistcalendars)

### Drive
- [`proton_drive_audit`](#protondriveaudit)
- [`proton_drive_status`](#protondrivestatus)
- [`proton_drive_organize`](#protondriveorganize)
- [`proton_drive_format_report`](#protondriveformatreport)
- [`proton_drive_list_files`](#protondrivelistfiles)
- [`proton_drive_download`](#protondrivedownload)
- [`proton_drive_upload`](#protondriveupload)
- [`proton_drive_share`](#protondriveshare)
- [`proton_drive_move`](#protondrivemove)
- [`proton_drive_copy`](#protondrivecopy)
- [`proton_drive_create_folder`](#protondrivecreatefolder)
- [`proton_drive_remove`](#protondriveremove)
- [`proton_drive_auth_status`](#protondriveauthstatus)
- [`proton_drive_auth_login`](#protondriveauthlogin)

### Suite
- [`proton_suite_status`](#protonsuitestatus)

### Agent
- [`proton_agent_plan`](#protonagentplan)

### Ecosystem
- [`proton_ecosystem_discover`](#protonecosystemdiscover)
- [`proton_ecosystem_health`](#protonecosystemhealth)
- [`proton_ecosystem_check_updates`](#protonecosystemcheckupdates)
- [`proton_ecosystem_install`](#protonecosysteminstall)

### Bridge
- [`proton_bridge_health`](#protonbridgehealth)
- [`proton_bridge_status`](#protonbridgestatus)
- [`proton_bridge_info`](#protonbridgeinfo)
- [`proton_bridge_login`](#protonbridgelogin)
- [`proton_bridge_logout`](#protonbridgelogout)
- [`proton_bridge_accounts`](#protonbridgeaccounts)

## Mail

### `proton_list_folders` {#protonlistfolders}

**Title:** List mailboxes (folders/labels)
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Lists every IMAP mailbox exposed by Proton Bridge (system folders like INBOX/Sent/Trash and user labels/folders). Use the returned 'path' values as the mailbox argument in other tools. Call this first when the agent doesn't know the mailbox layout.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` | Output format |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "folders": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "specialUse": {
            "type": [
              "string",
              "null"
            ]
          },
          "flags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "delimiter": {
            "type": [
              "string",
              "null"
            ]
          },
          "subscribed": {
            "type": "boolean"
          }
        },
        "required": [
          "path",
          "name",
          "flags"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "folders"
  ],
  "additionalProperties": false
}
```


### `proton_create_folder` {#protoncreatefolder}

**Title:** Create a mailbox (folder)
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Creates a new IMAP mailbox under the given path (e.g. 'Projects/Afiladocs').

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | required |  | Mailbox path to create |



### `proton_mailbox_status` {#protonmailboxstatus}

**Title:** Get mailbox counts
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Returns total messages, unseen/unread count and recent count for a mailbox. Fast — useful for Routines to check 'do I have unread mail?'.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` | Mailbox path, e.g. INBOX |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "mailbox": {
      "type": "string"
    },
    "messages": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "unseen": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "recent": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "uidNext": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "mailbox",
    "messages",
    "unseen",
    "recent"
  ],
  "additionalProperties": false
}
```


### `proton_list_emails` {#protonlistemails}

**Title:** List emails in a mailbox
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Lists recent emails in a mailbox, newest first. Use pagination with offset+limit. Returns UID, from, to, subject, date, flags, size. Does NOT return the body — use proton_get_email for that.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `limit` | integer | required | `25` |  |
| `offset` | integer | required | `0` |  |
| `response_format` | string | required | `"markdown"` | markdown table, json, or concise bullet list (fewer tokens) |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "mailbox": {
      "type": "string"
    },
    "total": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "count": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "offset": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "has_more": {
      "type": "boolean"
    },
    "next_offset": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "uid": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "from": {
            "type": "string"
          },
          "to": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "subject": {
            "type": "string"
          },
          "date": {
            "type": "string"
          },
          "flags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "size": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "uid",
          "flags"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "mailbox",
    "total",
    "count",
    "offset",
    "has_more",
    "items"
  ],
  "additionalProperties": false
}
```


### `proton_search_emails` {#protonsearchemails}

**Title:** Search emails
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Keyword-search emails in a mailbox. Filter by text in any field, or restrict to subject/from/to/body. Combine with date range and unseen flag. Returns newest matches first, up to 'limit'. Use 'text' for a broad 'anywhere' match.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `query` | string | optional |  | Keyword to search for |
| `fields` | array | required | `["text"]` | Which fields to search. 'text' = anywhere. |
| `since` | string | optional |  | ISO date — only messages on/after this date |
| `before` | string | optional |  | ISO date — only messages before this date |
| `unseen_only` | boolean | required | `false` | Only return unread messages |
| `from_address` | string | optional |  | Restrict to messages from this address |
| `to_address` | string | optional |  | Restrict to messages to this address |
| `limit` | integer | required | `25` |  |
| `response_format` | string | required | `"markdown"` | markdown table, json, or concise bullet list (fewer tokens) |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "mailbox": {
      "type": "string"
    },
    "matched": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "count": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "has_more": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "uid": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "from": {
            "type": "string"
          },
          "to": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "subject": {
            "type": "string"
          },
          "date": {
            "type": "string"
          },
          "flags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "size": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "uid",
          "flags"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "mailbox",
    "matched",
    "count",
    "has_more",
    "items"
  ],
  "additionalProperties": false
}
```


### `proton_get_email` {#protongetemail}

**Title:** Read one email (full body)
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Fetches one email by UID, with headers, text/html body and attachment metadata. Use proton_get_attachment to download attachment bytes. Large HTML bodies are returned as-is — truncate client-side if needed. To mark as read, call proton_flag_email separately (keeps this tool purely read-only).

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  | Message UID (from list/search) |
| `include_html` | boolean | required | `false` | Include HTML body in addition to text |
| `response_format` | string | required | `"markdown"` |  |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "uid": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "from": {
      "type": "string"
    },
    "to": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "cc": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "subject": {
      "type": "string"
    },
    "date": {
      "type": "string"
    },
    "flags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "textBody": {
      "type": "string"
    },
    "htmlBody": {
      "type": "string"
    },
    "attachments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "filename": {
            "type": "string"
          },
          "contentType": {
            "type": "string"
          },
          "size": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "contentType",
          "size"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "uid",
    "to",
    "cc",
    "flags",
    "attachments"
  ],
  "additionalProperties": false
}
```


### `proton_get_attachment` {#protongetattachment}

**Title:** Download an attachment
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Returns the bytes of a specific attachment encoded as base64. Use the attachment index from proton_get_email. Large attachments are truncated to max_bytes (default 10 MB) with a truncated=true flag in the response.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  |  |
| `index` | integer | required |  | Zero-based index in the attachments array |
| `max_bytes` | integer | required | `10485760` | Maximum attachment size in bytes (default 10 MB, hard cap 50 MB) |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "filename": {
      "type": "string"
    },
    "contentType": {
      "type": "string"
    },
    "size_bytes": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "returned_bytes": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "truncated": {
      "type": "boolean"
    },
    "base64": {
      "type": "string"
    }
  },
  "required": [
    "contentType",
    "size_bytes",
    "returned_bytes",
    "truncated",
    "base64"
  ],
  "additionalProperties": false
}
```


### `proton_send_email` {#protonsendemail}

**Title:** Send an email
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Sends an email via Proton Bridge SMTP. 'from' is fixed to the configured address. Provide either text, html, or both. Attachments are base64-encoded bytes.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `to` | array | required |  | Recipient addresses |
| `subject` | string | required |  |  |
| `text` | string | optional |  |  |
| `html` | string | optional |  |  |
| `cc` | array | optional |  |  |
| `bcc` | array | optional |  |  |
| `reply_to` | string | optional |  |  |
| `attachments` | array | optional |  |  |



### `proton_reply_email` {#protonreplyemail}

**Title:** Reply to an email
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Replies to an existing message preserving threading (In-Reply-To, References). Set reply_all=true to include CC recipients. Set include_quote=true to quote the original.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  |  |
| `text` | string | optional |  |  |
| `html` | string | optional |  |  |
| `reply_all` | boolean | required | `false` |  |
| `include_quote` | boolean | required | `true` |  |



### `proton_forward_email` {#protonforwardemail}

**Title:** Forward an email
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Forwards an existing message to new recipients. Optionally includes original attachments.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  |  |
| `to` | array | required |  |  |
| `text` | string | optional |  |  |
| `html` | string | optional |  |  |
| `include_attachments` | boolean | required | `true` |  |



### `proton_flag_email` {#protonflagemail}

**Title:** Flag / unflag emails
**Hints:** readOnly: false · destructive: false · idempotent: true · openWorld: true

**Description:** Toggles per-message flags. Supported: 'read', 'unread', 'starred', 'unstarred'. For custom flags, pass add_flags/remove_flags directly.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  |  |
| `action` | string | required |  | Shorthand action |
| `add_flags` | array | optional |  | Custom flags to add (action=custom only) |
| `remove_flags` | array | optional |  | Custom flags to remove (action=custom only) |



### `proton_move_email` {#protonmoveemail}

**Title:** Move an email to another mailbox
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Moves a message by UID from one mailbox to another. Use proton_list_folders to see valid targets.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `from_mailbox` | string | required |  |  |
| `uid` | integer | required |  |  |
| `to_mailbox` | string | required |  |  |



### `proton_delete_email` {#protondeleteemail}

**Title:** Delete an email
**Hints:** readOnly: false · destructive: true · idempotent: false · openWorld: true

**Description:** Deletes a message. Default mode='trash' moves it to Trash (reversible). mode='permanent' expunges immediately — cannot be undone.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mailbox` | string | required | `"INBOX"` |  |
| `uid` | integer | required |  |  |
| `mode` | string | required | `"trash"` |  |
| `trash_path` | string | optional |  | Override for the Trash mailbox path. If omitted, the \Trash special-use mailbox is auto-detected (works with Papelera/Corbeille/etc.). |



## Pass

### `proton_pass_list` {#protonpasslist}

**Title:** List Proton Pass entries
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Lists entries in the Proton Pass password store. Returns entry names/paths only — NEVER secret values.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `filter` | string | optional |  |  |
| `response_format` | string | required | `"json"` |  |



### `proton_pass_get` {#protonpassget}

**Title:** Resolve a secret from Proton Pass
**Hints:** openWorld: true

**Description:** Resolves a secret from Proton Pass. Returns {found:true} without the secret value.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | required |  | Entry path in the password store |



### `proton_pass_generate` {#protonpassgenerate}

**Title:** Generate a secure password
**Hints:** destructive: true · openWorld: true

**Description:** Generates a strong random password and saves it to the Proton Pass store. Refuses to overwrite an existing entry unless overwrite=true is set explicitly.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | required |  |  |
| `length` | integer | required | `24` |  |
| `overwrite` | boolean | required | `false` | Explicitly replace an existing entry. Leaves a backup copy of the previous ciphertext. Default: false (no-clobber). |



### `proton_pass_health` {#protonpasshealth}

**Title:** Check Proton Pass store health
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Verifies the Proton Pass password store is accessible.

**Input parameters:**

_This tool takes no arguments._



### `proton_pass_insert` {#protonpassinsert}

**Title:** Insert a secret into Proton Pass store
**Hints:** readOnly: false · destructive: true · idempotent: false · openWorld: false

**Description:** Not available in this profile: storing a secret would make it travel through the model. Run `pass insert <path>` on the machine instead.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | required |  | Entry path, e.g. proton/bridge/api-key |



### `proton_pass_remove` {#protonpassremove}

**Title:** Remove a secret from Proton Pass store
**Hints:** readOnly: false · destructive: true · idempotent: true · openWorld: false

**Description:** Permanently removes an entry from the local pass-store.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | required |  | Entry path to remove |



### `proton_pass_move` {#protonpassmove}

**Title:** Move/rename a secret in Proton Pass store
**Hints:** readOnly: false · destructive: false · idempotent: true · openWorld: false

**Description:** Moves or renames an entry in the local pass-store.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | string | required |  | Current entry path |
| `to` | string | required |  | New entry path |



### `proton_pass_copy` {#protonpasscopy}

**Title:** Copy a secret in Proton Pass store
**Hints:** readOnly: false · destructive: false · idempotent: true · openWorld: false

**Description:** Copies an entry in the local pass-store.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `src` | string | required |  | Source entry path |
| `dst` | string | required |  | Destination entry path |



## Calendar

### `proton_calendar_list_events` {#protoncalendarlistevents}

**Title:** proton_calendar_list_events
**Hints:** readOnly: true · destructive: false · openWorld: true

**Description:** [STUB] proton_calendar_list_events — E2E-encrypted sync, no CalDAV.

**Input parameters:**

_This tool takes no arguments._



### `proton_calendar_create_event` {#protoncalendarcreateevent}

**Title:** proton_calendar_create_event
**Hints:** readOnly: false · destructive: false · openWorld: true

**Description:** [STUB] proton_calendar_create_event — E2E-encrypted sync, no CalDAV.

**Input parameters:**

_This tool takes no arguments._



### `proton_calendar_list_calendars` {#protoncalendarlistcalendars}

**Title:** proton_calendar_list_calendars
**Hints:** readOnly: true · destructive: false · openWorld: true

**Description:** [STUB] proton_calendar_list_calendars — E2E-encrypted sync, no CalDAV.

**Input parameters:**

_This tool takes no arguments._



## Drive

### `proton_drive_audit` {#protondriveaudit}

**Title:** Audit Proton Drive content
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Scans the staging directory and returns an inventory report: total files, by type/size/date, duplicates, and obsolete formats.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |
| `staging_dir` | string | optional |  | Override staging directory path |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "totalFiles": {
      "type": "number"
    },
    "totalBytes": {
      "type": "number"
    },
    "duplicates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "hash": {
            "type": "string"
          },
          "size": {
            "type": "number"
          },
          "files": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "path": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                }
              },
              "required": [
                "path",
                "name"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "hash",
          "size",
          "files"
        ],
        "additionalProperties": false
      }
    },
    "obsoleteFiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "path": {
            "type": "string"
          },
          "ext": {
            "type": "string"
          },
          "size": {
            "type": "number"
          }
        },
        "required": [
          "name",
          "path",
          "ext",
          "size"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "totalFiles",
    "totalBytes",
    "duplicates",
    "obsoleteFiles"
  ],
  "additionalProperties": false
}
```


### `proton_drive_status` {#protondrivestatus}

**Title:** Proton Drive sync status
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Returns the current state of the proton-drive CLI binary and the local staging directory.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



### `proton_drive_organize` {#protondriveorganize}

**Title:** Organize files in Proton Drive
**Hints:** readOnly: false · destructive: true · idempotent: false · openWorld: true

**Description:** Analyzes the staging directory and moves files into a structured folder layout (by type). Dry-run by default. Never overwrites: colliding destinations are rejected unless strategy="rename".

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `dry_run` | boolean | required | `true` | If true, only shows the plan without moving files. |
| `staging_dir` | string | optional |  |  |
| `strategy` | string | required | `"reject"` | What to do when the destination is taken: reject (default, no-clobber) or rename (disambiguate). |



### `proton_drive_format_report` {#protondriveformatreport}

**Title:** Proton Drive format report
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Detailed analysis of file formats in the staging directory.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `staging_dir` | string | optional |  |  |
| `response_format` | string | required | `"markdown"` |  |



### `proton_drive_list_files` {#protondrivelistfiles}

**Title:** List files on Proton Drive
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Lists the contents of a remote Proton Drive path using the proton-drive CLI. Read-only.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `remote_path` | string | required | `"/my-files"` | Remote path on Proton Drive, e.g. /my-files/Documents. |
| `response_format` | string | required | `"markdown"` |  |



### `proton_drive_download` {#protondrivedownload}

**Title:** Download from Proton Drive to staging
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Downloads a remote Proton Drive path into the local staging directory using the proton-drive CLI. Idempotent.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `remote_path` | string | required | `"/my-files"` | Remote path on Proton Drive to download. |
| `local_path` | string | optional |  | Override staging directory locally. Defaults to configured stagingDir. |



### `proton_drive_upload` {#protondriveupload}

**Title:** Upload staging to Proton Drive
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: true

**Description:** Uploads the local staging directory to a remote Proton Drive path using the proton-drive CLI.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `local_path` | string | optional |  | Override staging directory locally. |
| `remote_path` | string | required | `"/my-files"` | Remote destination path on Proton Drive. |



### `proton_drive_share` {#protondriveshare}

**Title:** Share a Proton Drive path
**Hints:** readOnly: false · destructive: true · idempotent: false · openWorld: true

**Description:** Invites a Proton user to collaborate on a remote path using the proton-drive CLI.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `remote_path` | string | required |  | Remote Proton Drive path to share. |
| `user_email` | string | required |  | Email of the user to invite. |



### `proton_drive_move` {#protondrivemove}

**Title:** Move files on Proton Drive
**Hints:** readOnly: false · idempotent: true · openWorld: false

**Description:** Moves a remote path using the proton-drive CLI.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | string | required |  | Current remote path |
| `to` | string | required |  | Destination remote path |



### `proton_drive_copy` {#protondrivecopy}

**Title:** Copy files on Proton Drive
**Hints:** readOnly: false · destructive: false · idempotent: false · openWorld: false

**Description:** Copies a remote path using the proton-drive CLI.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `from` | string | required |  | Source remote path |
| `to` | string | required |  | Destination remote path |



### `proton_drive_create_folder` {#protondrivecreatefolder}

**Title:** Create folder on Proton Drive
**Hints:** readOnly: false · idempotent: true · openWorld: false

**Description:** Creates a new folder using the proton-drive CLI.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `remote_path` | string | required |  | Remote path for the new folder |



### `proton_drive_remove` {#protondriveremove}

**Title:** Remove files from Proton Drive
**Hints:** readOnly: false · destructive: true · idempotent: true · openWorld: false

**Description:** Permanently removes a remote path from Proton Drive. Destructive operation.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `remote_path` | string | required |  | Remote path to remove |



### `proton_drive_auth_status` {#protondriveauthstatus}

**Title:** Proton Drive authentication status
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Checks whether the proton-drive CLI is installed and authenticated.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` | Output format. |



### `proton_drive_auth_login` {#protondriveauthlogin}

**Title:** Authenticate with Proton Drive
**Hints:** readOnly: false · destructive: true · idempotent: false · openWorld: false

**Description:** Attempts to authenticate with the proton-drive CLI. Since the CLI requires interactive credentials, the tool returns a command the user must run in their terminal.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `force` | boolean | required | `false` | If true, skips the already-authenticated check and returns login instructions. |



## Suite

### `proton_suite_status` {#protonsuitestatus}

**Title:** Get Proton Suite unified status
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Reports the connection status, diagnostics, and metrics of all configured Proton Suite products.

**Input parameters:**

_This tool takes no arguments._



## Agent

### `proton_agent_plan` {#protonagentplan}

**Title:** Get agent organization/alert plan
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Analyzes the mailbox using the embedded agent rules and returns a proposed folder/label structure plus content alerts. This is a read-only planning tool; it does not move, flag or delete emails. Use it before running the CLI agent:organize command.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `goal` | string | required | `"organize"` | Agent goal: organize (propose folders/labels), monitor (inspect only), alert (threats only). |
| `response_format` | string | required | `"json"` | Output format. JSON is recommended for programmatic consumers. |

**Output schema:**

```json
{
  "type": "object",
  "properties": {
    "newFolders": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "folderProposals": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "emails": {
            "type": "array",
            "items": {
              "type": "number"
            }
          }
        },
        "required": [
          "path",
          "reason",
          "emails"
        ],
        "additionalProperties": false
      }
    },
    "labelProposals": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          },
          "emails": {
            "type": "array",
            "items": {
              "type": "number"
            }
          }
        },
        "required": [
          "name",
          "reason",
          "emails"
        ],
        "additionalProperties": false
      }
    },
    "alerts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "severity": {
            "type": "string",
            "enum": [
              "info",
              "warning",
              "alert",
              "critical"
            ]
          },
          "category": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "uids": {
            "type": "array",
            "items": {
              "type": "number"
            }
          }
        },
        "required": [
          "severity",
          "category",
          "message",
          "uids"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "newFolders",
    "folderProposals",
    "labelProposals",
    "alerts"
  ],
  "additionalProperties": false
}
```


## Ecosystem

### `proton_ecosystem_discover` {#protonecosystemdiscover}

**Title:** Discover Proton ecosystem binaries
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Which Proton product binaries are installed and their auth status.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



### `proton_ecosystem_health` {#protonecosystemhealth}

**Title:** Ecosystem health check
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Unified health status of all Proton ecosystem binaries. Returns a concise pass/fail summary.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



### `proton_ecosystem_check_updates` {#protonecosystemcheckupdates}

**Title:** Check for updates
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Available version updates for Proton binaries.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `product` | string | optional |  |  |



### `proton_ecosystem_install` {#protonecosysteminstall}

**Title:** Install Proton product
**Hints:** readOnly: false · destructive: true · idempotent: true · openWorld: false

**Description:** Instructions for installing a Proton product binary.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `product` | string | required | `"drive"` |  |



## Bridge

### `proton_bridge_health` {#protonbridgehealth}

**Title:** Bridge health check
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Checks if Proton Mail Bridge is running, ports are listening, and IMAP auth works.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



### `proton_bridge_status` {#protonbridgestatus}

**Title:** Bridge full status
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Returns combined info + health of the Bridge process in a single call.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



### `proton_bridge_info` {#protonbridgeinfo}

**Title:** Bridge info
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Returns Bridge version, user, and connection ports from the CLI.

**Input parameters:**

_This tool takes no arguments._



### `proton_bridge_login` {#protonbridgelogin}

**Title:** Login to Bridge
**Hints:** readOnly: false · destructive: true · openWorld: true

**Description:** Logs in to Proton Mail Bridge using the credentials configured on this machine (PROTON_BRIDGE_PASS or a password-store reference). Takes no arguments: the password never travels through you, and the result contains metadata only.

**Input parameters:**

_This tool takes no arguments._



### `proton_bridge_logout` {#protonbridgelogout}

**Title:** Logout from Bridge
**Hints:** readOnly: false · destructive: true · openWorld: true

**Description:** Logs out the current session from Proton Mail Bridge.

**Input parameters:**

_This tool takes no arguments._



### `proton_bridge_accounts` {#protonbridgeaccounts}

**Title:** List Bridge accounts
**Hints:** readOnly: true · idempotent: true · openWorld: true

**Description:** Lists all Proton accounts currently configured in Bridge with their connection state.

**Input parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `response_format` | string | required | `"markdown"` |  |



