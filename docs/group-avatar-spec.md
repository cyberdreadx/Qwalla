# Group chat avatars — backend spec

The Qwalla client is built and forward-compatible (see below). Group photos will
work end-to-end the moment the **daemon** and **@rougechain/sdk** add an `avatar`
field to the conversation-update path. Until then the client shows a picked photo
locally (like personal avatars) but it does not persist or reach other members.

## What the client already does (shipped)

- `components/chat/GroupInfoSheet.tsx` — tappable group avatar with a camera
  badge; picks a square image, compresses it to a `data:image/jpeg;base64,…`
  URI **≤ ~32 KB** via `compressTokenLogoToDataUri` (same path/limit as token
  logos), previews it immediately, and calls the API helper below.
- `lib/messenger-api.ts`
  - `setConversationAvatar(wallet, conversationId, name, avatar)` →
    `rc.messenger.updateConversation(wallet, conversationId, { name, avatar })`.
    The current name is passed so the update doesn't blank it.
  - `conversationAvatarOf(convo)` reads the avatar back from any of:
    `avatar | avatarUrl | avatar_url | groupAvatar | group_avatar`.
- `app/(tabs)/messenger/[id].tsx` renders the group avatar in the chat header
  (and stores a locally-picked one on `convoMeta.avatar`).

Because the client already passes `avatar` in the `updateConversation` opts and
already reads it back on load, **no client change is required** once the two
pieces below land — the same calls start persisting and displaying it.

## 1) SDK change (`@rougechain/sdk`)

`MessengerClient.updateConversation` currently signs only `{ conversationId, name }`.
Add `avatar` to the signed payload so the signature covers it:

```ts
async updateConversation(wallet, conversationId, opts = {}) {
  const signed = signRequest(wallet, {
    conversationId,
    name: opts.name,
    avatar: opts.avatar,          // NEW — data-URI string, or "" to clear
  });
  return this.rc.submitTx("/v2/messenger/conversations/update", signed);
}
```

- Type: `opts.avatar?: string`.
- Include `avatar` in the conversation objects returned by
  `getConversations` / `/conversations/list` (any of the key names the client
  accepts; `avatar` preferred).

## 2) Daemon change (quantum-vault-daemon)

`POST /v2/messenger/conversations/update`:

- Accept an optional `avatar` field in the (signed) body. Verify the signature
  over the full payload including `avatar` (any participant may set it, same
  authz as rename).
- **Validate size:** reject if `avatar` length > **32 KiB** of data-URI text
  (`{"success":false,"error":"Avatar too large (max 32KB)"}`), mirroring the
  inline token-logo cap. Optionally validate the `data:image/(jpeg|png|webp);base64,`
  prefix.
- Persist it on the conversation row. `avatar: ""` clears it. Leaving `avatar`
  absent must **not** overwrite an existing one (partial update) — the client
  sends `name` on avatar-only edits and `avatar` on name-only edits, so treat
  each field as "update if present".
- Return `avatar` in `/v2/messenger/conversations/list`.

### Notes
- The avatar is **not** end-to-end encrypted (it's group-visible metadata, like
  the group name). That's an intentional simplification; revisit if group
  metadata should be encrypted to members.
- 32 KB keeps it inline (no blob store needed) and matches the existing
  token-logo convention the client already compresses to.

## Test checklist
1. Set a group photo → reopen the chat on another member's device → photo shows
   in the header and (once wired) the conversation list.
2. `avatar: ""` clears it.
3. Oversized image is rejected with a clear error (client already compresses to
   ~32 KB, so this is a guard).
4. Renaming without sending `avatar` keeps the existing photo, and vice-versa.
