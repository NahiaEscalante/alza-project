/**
 * Meta Cloud API limits (D37, D46, D50), enforced by every adapter so a message that would be
 * rejected by Meta fails in tests and in the simulator first. Lengths use the domain's
 * `messageLength` (the same measure the close composer uses to fit its doubts).
 */
import { messageLength } from '../domain/index.js';
import {
  type ButtonsMessage,
  ChannelError,
  type ImageMessage,
  type OutboundContext,
  type TextMessage,
} from './types.js';

export const META_LIMITS = {
  textBody: 4_096,
  interactiveBody: 1_024,
  imageCaption: 1_024,
  maxButtons: 3,
  buttonTitle: 20,
  buttonId: 256,
  header: 60,
  footer: 60,
} as const;

const E164 = /^\+\d{8,15}$/;

function fail(message: string): never {
  throw new ChannelError('limit_exceeded', message);
}

function checkLength(label: string, value: string, max: number, min = 1): void {
  const length = messageLength(value);
  if (length < min) fail(`${label} is empty`);
  if (length > max) fail(`${label} has ${length} characters (max ${max})`);
}

export function assertValidContext(ctx: OutboundContext): void {
  if (!E164.test(ctx.to)) fail('recipient must be E.164');
  if (!ctx.userId) fail('userId is required');
  if (!/^WA-\d{2}$/.test(ctx.catalogId)) fail('catalogId must be a 12.1 id such as WA-10');
}

export function assertValidText(message: TextMessage): void {
  checkLength('text body', message.body, META_LIMITS.textBody);
}

export function assertValidButtons(message: ButtonsMessage): void {
  checkLength('interactive body', message.body, META_LIMITS.interactiveBody);
  const { buttons } = message;
  if (buttons.length < 1 || buttons.length > META_LIMITS.maxButtons) {
    fail(
      `interactive message needs 1 to ${META_LIMITS.maxButtons} buttons (got ${buttons.length})`,
    );
  }
  for (const button of buttons) {
    checkLength('button title', button.title, META_LIMITS.buttonTitle);
    checkLength('button id', button.id, META_LIMITS.buttonId);
  }
  if (new Set(buttons.map((b) => b.id)).size !== buttons.length) fail('button ids must be unique');
  if (new Set(buttons.map((b) => b.title)).size !== buttons.length) {
    fail('button titles must be unique');
  }
  if (message.header !== undefined) checkLength('header', message.header, META_LIMITS.header);
  if (message.footer !== undefined) checkLength('footer', message.footer, META_LIMITS.footer);
}

export function assertValidImage(message: ImageMessage): void {
  if (!message.mediaId) fail('image needs a media id');
  if (message.caption !== undefined) {
    checkLength('image caption', message.caption, META_LIMITS.imageCaption, 0);
  }
}
