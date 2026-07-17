# Google Calendar Provider — local setup

Sprint-015 (RFC-0003 §8c) adds Atlas's first real external Provider: a
**read-only** connection to a user's Google Calendar. This is not a general
OAuth framework — it's one specific integration, scoped to listing upcoming
events on the user's primary calendar. Atlas never creates, edits, deletes,
or RSVPs to anything, and no write scope is ever requested.

## 1. Create a Google Cloud project

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and
   create a new project (or reuse an existing one you control).
2. In **APIs & Services → Library**, enable the **Google Calendar API**.

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. Choose **External** (unless you have a Google Workspace org and want
   **Internal**).
3. Fill in the required app fields (name, support email). You do not need
   to submit for verification for local development/testing with your own
   Google account added as a test user.
4. Under **Scopes**, add `https://www.googleapis.com/auth/calendar.events.readonly`
   — the narrowest scope that covers listing events. Do not add
   `calendar.readonly`; it also exposes calendar list/settings this
   Provider never uses.
5. Under **Test users** (while the app is in "Testing" publishing status),
   add the Google account(s) you'll use to test the connect flow.

## 3. Create an OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add exactly:

   ```
   http://localhost:3000/api/providers/google-calendar/callback
   ```

   Production deployments need their own HTTPS redirect URI registered
   separately in the same console — this codebase never hardcodes a
   production domain; the redirect URI always comes from
   `GOOGLE_CALENDAR_REDIRECT_URI`. See `docs/deployment.md` (Sprint-039)
   for the exact production steps once a Vercel domain exists.
4. Save the generated **Client ID** and **Client secret**.

## 4. Environment variables

Copy `.env.example`'s Sprint-015 block into your `.env` and fill in:

```
GOOGLE_CALENDAR_CLIENT_ID=<from step 3>
GOOGLE_CALENDAR_CLIENT_SECRET=<from step 3>
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/providers/google-calendar/callback
ATLAS_TOKEN_ENCRYPTION_KEY=<generate below>
```

Generate `ATLAS_TOKEN_ENCRYPTION_KEY` (a base64-encoded 32-byte AES-256 key
used to encrypt tokens at rest — never commit a real one):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Without a valid `ATLAS_TOKEN_ENCRYPTION_KEY`, the connect route refuses to
start the flow rather than beginning something that can't complete.

## 5. Using it

Visit `/providers` while signed in to Atlas and click **Connect** next to
Google Calendar. You'll be sent to Google's real consent screen requesting
only the read-only calendar scope; after granting access, you're redirected
back and the page shows your next 10 upcoming events.

## 6. Disconnecting during local development

- Click **Disconnect** on the `/providers` page — this revokes the token
  with Google where possible and always clears Atlas's local record of the
  connection, even if the remote revoke call fails.
- As a fallback (e.g. if you want to fully reset test-account state), visit
  <https://myaccount.google.com/permissions> and remove the app's access
  directly from your Google account.
