import { createSocialImage, SOCIAL_IMAGE_SIZE } from "./social-image";

export const alt = "Glossary 용어집 — 우리의 말을, 우리의 기준으로";
export const size = SOCIAL_IMAGE_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return createSocialImage();
}
