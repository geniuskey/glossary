import { surfaceKeys } from "@glossary/db";
import { deriveSurfaces } from "./surfaces";
import type { TermInput } from "./schema";
import { normalizeTags } from "./tags";

export type MergeContent = Pick<TermInput, "nameEn" | "nameKo" | "fullNameEn" | "fullNameKo" | "definitionMd" | "bodyMd" | "domain" | "category" | "surfaces" | "topic" | "tags">;

/** Keep the representative's definition; retain the other definition and body verbatim. */
export function mergeContent(target: MergeContent, source: MergeContent): MergeContent {
  const paragraphs = [target.bodyMd ?? ""];
  if (source.definitionMd && source.definitionMd !== target.definitionMd && target.definitionMd) paragraphs.push(source.definitionMd);
  if (source.bodyMd && source.bodyMd !== target.bodyMd) paragraphs.push(source.bodyMd);
  const tags = normalizeTags([...(target.tags ?? (target.topic ? [target.topic] : [])), ...(source.tags ?? (source.topic ? [source.topic] : []))]);
  const seen = new Set<string>();
  const surfaces = [...deriveSurfaces(target, target.surfaces ?? []), ...deriveSurfaces(source, source.surfaces ?? [])]
    .filter((surface) => {
      const key = `${surfaceKeys(surface.text).normLoose}:${surface.kind}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  return {
    nameEn: target.nameEn || source.nameEn, nameKo: target.nameKo || source.nameKo,
    fullNameEn: target.fullNameEn || source.fullNameEn, fullNameKo: target.fullNameKo || source.fullNameKo,
    definitionMd: target.definitionMd || source.definitionMd || "",
    bodyMd: [...new Set(paragraphs.filter(Boolean))].join("\n\n"),
    domain: [...new Set([...(target.domain ?? []), ...(source.domain ?? [])])],
    category: [...new Set([...(target.category ?? []), ...(source.category ?? [])])],
    topic: tags[0] ?? null,
    tags,
    surfaces,
  };
}
