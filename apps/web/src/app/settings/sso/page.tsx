import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata = { title: "SSO" };

export default async function SsoSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // 화면을 막는 것만으로는 부족하고 /api/v1/sso도 requireAdminUser로 막혀 있다.
  // 여기서 되돌리는 것은 편집자에게 못 채우는 폼을 보여 주지 않기 위해서다.
  if (user.role !== "admin") redirect("/");
  redirect("/admin?tab=sso");
}
