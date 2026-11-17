import { z } from "zod/v3";
import { COMMENT_BODY_MAX } from "./tree";

const body = z.string().trim().min(1, "댓글 내용을 입력해 주세요.").max(COMMENT_BODY_MAX, `댓글은 ${COMMENT_BODY_MAX}자까지 쓸 수 있습니다.`);

export const commentCreateSchema = z.object({ body, parentId: z.string().uuid().nullish() }).strict();
export const commentUpdateSchema = z.object({ body }).strict();
