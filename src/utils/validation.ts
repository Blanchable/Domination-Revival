import { z } from 'zod';

// ─── Order payload schemas ──────────────────────────────────────────────────

export const MoveOrderPayload = z.object({
  fromProvinceId: z.string(),
  toProvinceId: z.string(),
  troopsCommitted: z.number().int().min(0),
  mercsCommitted: z.number().int().min(0),
});

export const BuildOrderPayload = z.object({
  provinceId: z.string(),
  buildingType: z.enum(['MINT', 'GRANARY', 'SHRINE', 'BARRACKS', 'FORTRESS']),
});

export const UpgradeOrderPayload = z.object({
  provinceId: z.string(),
  buildingType: z.enum(['MINT', 'GRANARY', 'SHRINE', 'BARRACKS', 'FORTRESS']),
});

export const RecruitOrderPayload = z.object({
  provinceId: z.string(),
  regularCount: z.number().int().min(0).default(0),
  mercCount: z.number().int().min(0).default(0),
});

export const AllianceInvitePayload = z.object({
  inviteePlayerId: z.string(),
});

export const AllianceAcceptPayload = z.object({
  allianceId: z.string(),
});

export const AllianceRenamePayload = z.object({
  allianceId: z.string(),
  newName: z.string().min(1).max(50),
});

export const DonatePayload = z.object({
  recipientPlayerId: z.string(),
  gold: z.number().int().min(0).default(0),
  food: z.number().int().min(0).default(0),
});

export const SupportPayload = z.object({
  recipientPlayerId: z.string(),
  troops: z.number().int().min(0).default(0),
  mercs: z.number().int().min(0).default(0),
  toProvinceId: z.string().optional(),
});

export const PopeActionPayload = z.object({
  ability: z.enum(['BLESSING', 'EXCOMMUNICATION', 'TITHE', 'INTERDICT']),
  targetPlayerId: z.string().optional(),
  targetProvinceId: z.string().optional(),
});

export type MoveOrderPayloadType = z.infer<typeof MoveOrderPayload>;
export type BuildOrderPayloadType = z.infer<typeof BuildOrderPayload>;
export type UpgradeOrderPayloadType = z.infer<typeof UpgradeOrderPayload>;
export type RecruitOrderPayloadType = z.infer<typeof RecruitOrderPayload>;
export type AllianceInvitePayloadType = z.infer<typeof AllianceInvitePayload>;
export type AllianceAcceptPayloadType = z.infer<typeof AllianceAcceptPayload>;
export type AllianceRenamePayloadType = z.infer<typeof AllianceRenamePayload>;
export type DonatePayloadType = z.infer<typeof DonatePayload>;
export type SupportPayloadType = z.infer<typeof SupportPayload>;
export type PopeActionPayloadType = z.infer<typeof PopeActionPayload>;
