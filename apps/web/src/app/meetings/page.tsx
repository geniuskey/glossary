import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDomains } from "@/lib/terms/domains";
import { listMeetingDocuments, toMeetingDocumentWire } from "@/lib/meetings/store";
import { MeetingDocumentsPanel } from "./meeting-documents-panel";

export const metadata = { title: "회의록 지식" };

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [meetings, domains] = await Promise.all([
    listMeetingDocuments({ page: 1, pageSize: 50 }),
    listDomains(),
  ]);
  return (
    <AppShell user={user} title="회의록 지식" current="meetings" roomy>
      <MeetingDocumentsPanel
        initialMeetings={meetings.items.map((meeting) => toMeetingDocumentWire(meeting))}
        domains={domains.map((domain) => ({ key: domain.key, label: domain.label }))}
      />
    </AppShell>
  );
}
