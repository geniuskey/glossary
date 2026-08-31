# 첨부 이미지 API

본문 이미지는 PostgreSQL에 WebP로 저장한다. 모든 엔드포인트는 세션 또는 API 키 인증이 필요하다.

## 업로드

`POST /api/v1/attachments`에 `multipart/form-data`의 `file` 필드로 PNG, JPEG 또는 WebP를 보낸다.

- 원본은 최대 10MB다.
- 긴 변은 2560px 이하로 축소한다.
- 메타데이터를 제거하고 WebP로 변환한다.
- 무손실과 품질 82 손실 인코딩 중 작은 결과를 고르고, 2MB를 넘으면 품질을 단계적으로 낮춘다.
- 변환 결과의 SHA-256이 같으면 기존 첨부를 재사용한다.

성공 응답의 `url`을 Markdown 이미지 주소로 사용한다.

```json
{
  "sha256": "…",
  "url": "/api/v1/attachments/<sha256>",
  "mime": "image/webp",
  "byteSize": 18342,
  "width": 1280,
  "height": 720,
  "originalFilename": "diagram.png"
}
```

## 조회

`GET /api/v1/attachments/{sha256}`는 변환된 WebP를 돌려준다. 응답은 내용 불변 URL이며
`ETag`와 `Cache-Control: private, max-age=31536000, immutable`을 사용한다.
