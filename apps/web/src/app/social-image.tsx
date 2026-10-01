import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;

const [pretendardRegular, pretendardBold] = await Promise.all([
  readFile(join(process.cwd(), "node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf")),
  readFile(join(process.cwd(), "node_modules/pretendard/dist/public/static/alternative/Pretendard-Bold.ttf")),
]);

export function createSocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, #f8f7ff 0%, #ffffff 54%, #f5f2ff 100%)",
          color: "#17152c",
          fontFamily: "Pretendard",
          padding: "58px 68px",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -110,
            top: -205,
            width: 610,
            height: 610,
            borderRadius: 305,
            backgroundColor: "#eeeaff",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 64,
            bottom: -190,
            width: 360,
            height: 360,
            borderRadius: 180,
            backgroundColor: "#fceee9",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column", position: "relative", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                background: "linear-gradient(145deg, #7569ef 0%, #5144d6 100%)",
                color: "white",
                fontSize: 36,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              G
              <div style={{ position: "absolute", right: 6, top: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: "#f06f4f", border: "2px solid white" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>Glossary</div>
              <div style={{ fontSize: 13, color: "#77748c", letterSpacing: 1.6 }}>TEAM LANGUAGE, SHARED</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 62, width: 600 }}>
            <div style={{ fontSize: 57, fontWeight: 700, lineHeight: 1.25, letterSpacing: -2.5 }}>우리의 말을,</div>
            <div style={{ fontSize: 57, fontWeight: 700, lineHeight: 1.25, letterSpacing: -2.5, color: "#6255df" }}>우리의 기준으로.</div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 23, lineHeight: 1.55, color: "#5f5c72" }}>
              누구나 찾고, 제안하고, 함께 다듬는 팀 용어집
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: "auto", fontSize: 14, color: "#8a879d" }}>
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#f06f4f" }} />
            <div>우리 팀의 말에 맥락과 기준을 더합니다</div>
          </div>
        </div>

        <div style={{ width: 415, display: "flex", position: "relative", alignItems: "center", justifyContent: "center", marginLeft: 10 }}>
          <div
            style={{
              width: 382,
              minHeight: 352,
              display: "flex",
              flexDirection: "column",
              borderRadius: 28,
              border: "1px solid #e8e5f2",
              backgroundColor: "rgba(255,255,255,0.95)",
              boxShadow: "0 24px 70px rgba(67, 56, 160, 0.14)",
              padding: 30,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#8b879d", letterSpacing: 1.4 }}>GLOSSARY ENTRY</div>
              <div style={{ display: "flex", borderRadius: 20, backgroundColor: "#f0edff", color: "#6155cf", padding: "7px 12px", fontSize: 13, fontWeight: 700 }}>표준 용어</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
              <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1.3 }}>공통 언어</div>
              <div style={{ marginTop: 5, fontSize: 18, color: "#858196" }}>shared language</div>
            </div>

            <div style={{ display: "flex", marginTop: 25, height: 1, backgroundColor: "#eeecf4" }} />

            <div style={{ display: "flex", flexDirection: "column", marginTop: 22, gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#8b879d" }}>정의</div>
              <div style={{ fontSize: 20, lineHeight: 1.48, color: "#39364e" }}>같은 단어가 같은 뜻으로</div>
              <div style={{ fontSize: 20, lineHeight: 1.48, color: "#39364e" }}>쓰이도록 팀이 함께 정한 기준</div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 22 }}>
              {[
                { label: "맥락", color: "#f4f1ff", text: "#6559d7" },
                { label: "기준", color: "#fff2ed", text: "#cf694e" },
                { label: "합의", color: "#eef6f4", text: "#438477" },
              ].map((tag) => (
                <div key={tag.label} style={{ display: "flex", borderRadius: 18, padding: "7px 12px", backgroundColor: tag.color, color: tag.text, fontSize: 13, fontWeight: 700 }}>
                  {tag.label}
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              right: 4,
              top: 84,
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 24,
              backgroundColor: "#f06f4f",
              color: "white",
              fontSize: 23,
              fontWeight: 700,
              boxShadow: "0 10px 24px rgba(240, 111, 79, 0.28)",
            }}
          >
            +
          </div>
        </div>
      </div>
    ),
    {
      ...SOCIAL_IMAGE_SIZE,
      fonts: [
        { name: "Pretendard", data: pretendardRegular, style: "normal", weight: 400 },
        { name: "Pretendard", data: pretendardBold, style: "normal", weight: 700 },
      ],
    },
  );
}
