import { z } from "zod";

/** A page is an ordered list of these. Stored in Page.sections (Json). */
export const sectionSchema = z.object({
  type: z.string(),
  props: z.record(z.unknown()).default({}),
});

export const pageSectionsSchema = z.array(sectionSchema);

export type Section = z.infer<typeof sectionSchema>;
