import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { createCustomerAction } from "@/features/customers/actions";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { requireStoreContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "New customer · Stocktill" };

export default async function NewCustomerPage() {
  await requireStoreContext();
  return (
    <>
      <PageHeader title="New customer" />
      <Card>
        <CustomerForm
          action={createCustomerAction}
          submitLabel="Create customer"
          defaults={{ name: "", documentId: "", phone: "", email: "", notes: "" }}
        />
      </Card>
    </>
  );
}
