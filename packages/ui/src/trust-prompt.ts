export interface TrustPromptOptions {
  container: Element;
  publicKeyHex: string;
  /** Human label for the sender, if one was available (e.g. a proposal's `origin.label`). */
  originLabel?: string;
  onTrust: () => void;
  onReject: () => void;
}

/** Groups a hex string into 4-char chunks for human comparison — the same convention SSH/PGP fingerprints use. */
export function formatFingerprint(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

/**
 * Trust-on-first-use confirmation: "New sender — confirm public key: ...".
 * The sender's public key already arrived as part of the artifact's own
 * signature (Ed25519 signatures carry the signer's public key inline), so
 * no separate key-exchange step is needed — this is purely the human
 * confirmation step before that key is added to the receiver's trust list.
 *
 * This renders nothing about the pending artifact itself; the caller is
 * responsible for actually trusting the key (typically via
 * `<optical-receive>`'s `trustSenderAndContinue()`) and re-processing —
 * rendering is never authority, same as every other prompt in `@oat/ui`.
 */
export function renderTrustPrompt(options: TrustPromptOptions): void {
  const { container, publicKeyHex, originLabel, onTrust, onReject } = options;
  container.replaceChildren();

  const panel = document.createElement('div');
  panel.setAttribute('part', 'trust-panel');

  const heading = document.createElement('h3');
  heading.textContent = 'New sender';
  panel.appendChild(heading);

  const message = document.createElement('p');
  message.textContent = originLabel
    ? `"${originLabel}" signed this with a key this receiver hasn't seen before.`
    : "This artifact is signed with a key this receiver hasn't seen before.";
  panel.appendChild(message);

  const fingerprint = document.createElement('p');
  fingerprint.setAttribute('part', 'fingerprint');
  const fingerprintLabel = document.createElement('strong');
  fingerprintLabel.textContent = 'Confirm public key: ';
  fingerprint.appendChild(fingerprintLabel);
  fingerprint.append(formatFingerprint(publicKeyHex));
  panel.appendChild(fingerprint);

  const trustBtn = document.createElement('button');
  trustBtn.type = 'button';
  trustBtn.textContent = 'Trust this sender';
  trustBtn.addEventListener('click', onTrust);

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', onReject);

  panel.append(trustBtn, rejectBtn);
  container.appendChild(panel);
}
