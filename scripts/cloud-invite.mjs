import { createInvite, INVITE_SECONDS } from '../server/cloud/session.mjs';

const secret = process.env.VOICE_SUITE_CLOUD_SECRET;
if (!secret || secret.length < 32) {
  console.error('Load the Cloud signing secret from the deployment’s secret store.');
  process.exit(1);
}
const actor = process.argv[2];
if (!actor) {
  console.error('Usage: node scripts/cloud-invite.mjs <existing-or-new-account-id>');
  process.exit(1);
}
console.error(
  `Invitation for ${actor}. Share privately. Expires in ${INVITE_SECONDS / 60} minutes.`,
);
console.log(createInvite(secret, actor));
