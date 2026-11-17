# OTA & CI/CD Security Hardening

Protecting Qwalla's highest-impact attack surface: the over-the-air update
pipeline. A published JS bundle runs on every user's device, so whoever can
publish an OTA can steal keys or rewrite transactions without touching the
chain's cryptography. This document records what changed, the verification
evidence, the exact manual steps still required, and the residual risks.

> Status: code/workflow changes committed on branch `security/ota-cicd-hardening`.
> GitHub settings + the private-key secret + a new signed store build are
> **owner actions** (below) and are NOT yet applied.

---

## 1. What changed (committed)

| Phase | Change | File |
|---|---|---|
| 1 — Containment | Removed auto-publish on push to master. Production OTA now runs **only** on manual `workflow_dispatch`, in the **`production` GitHub Environment** (approval gate), least-privilege token, and **fails closed if no signing key is present** (can't ship unsigned). | `.github/workflows/eas-update.yml` |
| 2 — Code signing | Configured EAS Update code signing. `app.json → updates.codeSigningCertificate: ./certs/certificate.pem` + `codeSigningMetadata`. The build embeds the public cert; the client **verifies every update's signature** and rejects unsigned/tampered ones. | `app.json`, `certs/certificate.pem` |
| 2 — Key hygiene | Private key material git-ignored (`keys/`, `*private-key*.pem`); only the **public** cert is committed (explicit `!certs/certificate.pem` exception to the broad `*.pem` ignore). | `.gitignore` |
| 4 — CI hardening | All GitHub Actions pinned to **full commit SHAs**; least-privilege `permissions: contents: read` on `ci.yml` + `eas-update.yml`; added an informational runtime-dependency `npm audit` job. | `ci.yml`, `eas-update.yml`, `mac-desktop.yml` |

Verified: no `pull_request_target` anywhere (the dangerous pattern); no private
key in the committed tree.

### Code-signing material
- **Certificate** (public, committed): `certs/certificate.pem`
  - SHA-256 fingerprint: `86:50:D8:F4:38:DF:71:8E:CF:21:56:E5:F3:E9:E3:F5:19:3C:9B:DC:4E:DB:23:AF:07:27:DF:5A:E9:55:F2:31`
  - Validity: 2026-11-17 → **2036-11-17** (rotate before expiry)
- **Private key** (secret, git-ignored, local only): `keys/private-key.pem`
- `codeSigningMetadata`: `{ keyid: "main", alg: "rsa-v1_5-sha256" }`

---

## 2. Private-key storage, backup & rotation — **do this first**

The private key lives ONLY at `keys/private-key.pem` on this machine and is
git-ignored. If it leaks, an attacker can sign malicious updates. If it is lost,
you can no longer publish updates to the current signed binaries (you must ship a
new build with a new cert).

1. **Back it up** to a secrets manager (1Password / Bitwarden / a hardware-backed
   store). Keep it out of email, Slack, cloud drives, and any repo.
2. **Add it as a GitHub Actions secret** so the OTA workflow can sign:
   - Settings → Secrets and variables → Actions → New repository secret
   - Name: `EXPO_UPDATES_PRIVATE_KEY`
   - Value: the full contents of `keys/private-key.pem` (including the
     `-----BEGIN/END PRIVATE KEY-----` lines)
   - Or via CLI: `gh secret set EXPO_UPDATES_PRIVATE_KEY < keys/private-key.pem`
3. **Rotation** (do before the 2036 expiry, or immediately if the key is ever
   suspected compromised): regenerate the pair, re-configure, ship a new build,
   and update the secret:
   ```
   npx expo-updates codesigning:generate --key-output-directory keys \
     --certificate-output-directory certs --certificate-validity-duration-years 10 \
     --certificate-common-name "RougeChain Technologies LLC"
   npx expo-updates codesigning:configure --certificate-input-directory certs --key-input-directory keys
   gh secret set EXPO_UPDATES_PRIVATE_KEY < keys/private-key.pem
   ```
   Then rebuild + resubmit (the new cert must reach users in a store build before
   updates signed by the new key will verify on their devices).

---

## 3. GitHub protection to apply (owner action)

These re-add the human gate that auto-OTA removed. Public repo → Environments and
branch protection are available. **Solo-maintainer caution:** do NOT require PR
reviews if you're the only maintainer (you can't approve your own PR → you lock
yourself out). The **Environment approval gate** is the safe control for a solo
maintainer (you can approve your own deployments).

### 3a. Production Environment + approval gate (the key control)
```
# Create the environment and require the owner to approve each OTA publish.
gh api -X PUT repos/cyberdreadx/Qwalla/environments/production \
  -f 'wait_timer=0' \
  -F 'reviewers[][type]=User' -F 'reviewers[][id]=205371434' \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
# Restrict which branch the OTA can deploy from (master only):
gh api -X POST repos/cyberdreadx/Qwalla/environments/production/deployment-branch-policies \
  -f 'name=master' -f 'type=branch'
```
Effect: running the OTA workflow pauses until the required reviewer approves, from
master only. A compromised developer account can't publish alone.

### 3b. Branch protection on master
```
# Keep the status check; enforce it on admins too; (reviews only if you add a 2nd maintainer).
gh api -X PUT repos/cyberdreadx/Qwalla/branches/master/protection \
  -H "Accept: application/vnd.github+json" \
  -F 'required_status_checks[strict]=true' \
  -F 'required_status_checks[contexts][]=install + typecheck' \
  -F 'enforce_admins=true' \
  -F 'required_pull_request_reviews=null' \
  -F 'restrictions=null'
# When a 2nd maintainer exists, require review:
#   -F 'required_pull_request_reviews[required_approving_review_count]=1'
#   -F 'required_pull_request_reviews[dismiss_stale_reviews]=true'
```
`enforce_admins=true` means even admins must pass CI — reversible if it becomes
inconvenient. Leaving `required_pull_request_reviews=null` avoids the solo
lockout; turn it on once a second reviewer exists.

### 3c. Native secret scanning + push protection (free, public repo)
```
gh api -X PATCH repos/cyberdreadx/Qwalla \
  -F 'security_and_analysis[secret_scanning][status]=enabled' \
  -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

---

## 4. `EXPO_TOKEN` scope & default-permissions review (Phase 4)

- **Scope the Expo token.** The OTA workflow needs publish rights only. In
  expo.dev → Account → Access tokens, prefer a token scoped to this project /
  update-publishing rather than a full account token. Rotate it periodically and
  immediately if CI logs are ever exposed.
- **Default workflow token.** `ci.yml` and `eas-update.yml` now declare
  `permissions: contents: read`. Consider also setting the **repo-wide** default
  to read-only: Settings → Actions → General → Workflow permissions →
  "Read repository contents and packages permissions". `mac-desktop.yml` keeps
  `contents: write` (needs it for `gh release upload`) — that's explicit and
  scoped to that workflow.
- **Restrict production secrets to the deploy workflow.** `EXPO_UPDATES_PRIVATE_KEY`
  and `EXPO_TOKEN` are only referenced by `eas-update.yml`; the Environment gate
  (3a) further ensures they're only usable after approval.

---

## 5. Migration — how existing users move to signed updates

**No breakage for current users.** A client built WITHOUT the cert (every current
store install) ignores update signatures and keeps accepting updates exactly as
before. A client built WITH the cert verifies and rejects unsigned/tampered ones.
Signed updates are accepted by both. So the rollout is safe and gradual:

1. **Ship a new store build** that embeds the cert (the cert is a build-time
   artifact → OTA alone can't deliver it). Recommend bumping `expo.version` so
   it's a clean new runtime/build. Submit to App Store + Play.
2. From now on, **only publish SIGNED updates** (the workflow enforces this).
3. As users update to the new build, their devices begin rejecting any
   unsigned/tampered update. Users on the old build are unaffected until they
   update.
4. **Stale-update note:** the last *unsigned* production update currently on the
   channel would be rejected by a new cert-binary (which falls back to its
   embedded bundle) — publish a fresh signed update after the new build is live so
   the channel's newest update is signed.

---

## 6. Validation evidence

- `eas-update.yml` has **no `push` trigger** → an ordinary `git push` to master
  can no longer publish to production. (Phase 5: verified by grep — see below.)
- `app.json` → `updates.codeSigningCertificate: ./certs/certificate.pem`,
  `codeSigningMetadata.alg: rsa-v1_5-sha256`.
- `git check-ignore keys/private-key.pem` → ignored; `certs/certificate.pem` →
  tracked; staged diff contains no `BEGIN … PRIVATE KEY`.
- All Actions pinned to SHAs (`grep "uses: .*@v[0-9]"` → none).
- `tsc --noEmit` clean; full test suite green.

**Signed-vs-unsigned runtime rejection** can only be fully proven on a build that
embeds the cert: build a dev/preview client, publish one signed update (accepted)
and one unsigned/tampered update (expect the client to reject it and keep its
current bundle). This requires a native build and is listed under manual steps.

---

## 7. Residual risks / not-yet-done

- The protection is only **real once the new signed build is in users' hands** —
  until then the current binaries still accept unsigned updates.
- `required_pull_request_reviews` is intentionally **off** (solo-maintainer
  lockout) — a single trusted developer can still push to master; the Environment
  approval gate is the compensating control for *production publish*.
- The runtime `npm audit` job is **informational** (doesn't block) — tighten to a
  gate once runtime deps are clean.
- `EXPO_TOKEN` scope/rotation is a manual Expo-side action (can't be verified from
  the repo).
- Code signing protects OTA JS only — it does not protect the **store binaries**
  themselves (those rely on Apple/Google signing) or the backend/RPC surfaces,
  which are separate audits.

---

## Manual steps checklist (owner)

- [ ] Back up `keys/private-key.pem` to a secrets manager; confirm it's NOT in git.
- [ ] `gh secret set EXPO_UPDATES_PRIVATE_KEY < keys/private-key.pem`
- [ ] Apply §3a (production Environment + reviewer), §3b (branch protection),
      §3c (secret scanning).
- [ ] Scope + rotate `EXPO_TOKEN`; set repo default workflow token to read-only (§4).
- [ ] Merge `security/ota-cicd-hardening` to master.
- [ ] Build + submit a new store build (cert embedded); then publish a fresh
      signed update and test accept/reject on a cert-build (§5, §6).
