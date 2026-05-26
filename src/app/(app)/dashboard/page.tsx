import { DashboardView } from "@/components/DashboardView";

interface PageProps {
  searchParams: Promise<{ asProfile?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const { asProfile } = await searchParams;
  return <DashboardView disciplineCode={null} asProfile={asProfile ?? null} />;
}
