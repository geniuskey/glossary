import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listMeetingDocuments, toMeetingDocumentWire } from "@/lib/meetings/store";
import { MeetingDocumentsPanel } from "./meeting-documents-panel";

export const metadata = { title: "회의 지식 인박스" };

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const meetings = await listMeetingDocuments({ page: 1, pageSize: 50 });
  return (
    <AppShell user={user} title="회의 지식 인박스" current="meetings" roomy>
      <MeetingDocumentsPanel
        initialMeetings={meetings.items.map((meeting) => toMeetingDocumentWire(meeting))}
        confluenceUrl={process.env.GLOSSARY_CONFLUENCE_MEETINGS_URL?.trim() || null}
      />
    </AppShell>
  );
}
