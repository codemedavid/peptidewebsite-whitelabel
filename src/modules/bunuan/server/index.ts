import "server-only";

// Bunuan's server: stages, the live counter, the checkout cap and admin order
// edits. Session-gated doors are in ../actions.ts; these take a resolved ctx.

export { getRoundStage, setStage, stageView, stageSyncForSave, loadReportKits, writeStageMove, gbFail, stagesOn, type GbCtx, type StageMoveDone } from "./stage";
export { getBunuanCounter } from "./counter";
export { editOrderLines, type EditCtx } from "./order-edit";
export { bunuanPrecheck, enforceBunuanCap, finishBunuanOrder, BunuanCapError, type BunuanScope } from "./cap";
export * from "./round-state";
