"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { createApplicant } from "@/actions/applicants";
import { underField } from "@/lib/actionResult";

type Field = "fullName" | "email" | "phone" | "role" | "source" | "notes";
const FIELDS: Field[] = ["fullName", "email", "phone", "role", "source", "notes"];
// The ceilings actions/applicants applicantInput enforces, typed into the
// inputs so nobody can write past them.
const MAX = { fullName: 120, email: 254, phone: 32, role: 120, notes: 2000 } as const;
// A shape check only — the server's zod email() has the final word.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewApplicantForm() {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [role, setRole] = React.useState("");
  const [source, setSource] = React.useState<string>("Indeed");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<Field | "form", string>>>({});

  async function save() {
    const errs: Partial<Record<Field, string>> = {};
    if (!fullName.trim()) errs.fullName = "Enter the applicant's name.";
    if (!role.trim()) errs.role = "Enter the role they applied for.";
    if (!email.trim()) errs.email = "Enter an email address.";
    else if (!EMAIL_SHAPE.test(email.trim())) errs.email = "Enter a valid address, like name@company.com.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const res = await createApplicant({
        fullName,
        email,
        phone: phone || null,
        role,
        source,
        notes: notes || null,
      });
      if (!res.ok) {
        // The server's refusal lands under the field it names, else above the buttons.
        const field = res.field as Field | undefined;
        setErrors(field && FIELDS.includes(field) && field !== "source" ? { [field]: underField(res) } : { form: res.error });
        return;
      }
      toast.success("Added");
      router.push(`/dashboard/hire/${res.id}` as any);
    } catch (err: any) {
      toast.error("Couldn't add", err?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Applicant</CardTitle>
          <CardSubtitle>You can refine notes and status from the detail page.</CardSubtitle>
        </div>
      </CardHeader>
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Input
            label="Full name"
            value={fullName}
            maxLength={MAX.fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.fullName}
            aria-invalid={!!errors.fullName}
          />
          <Input
            label="Role"
            value={role}
            maxLength={MAX.role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Roofer, Estimator, Foreman…"
            error={errors.role}
            aria-invalid={!!errors.role}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Input
            label="Email"
            type="email"
            value={email}
            maxLength={MAX.email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            aria-invalid={!!errors.email}
          />
          <Input
            label="Phone"
            type="tel"
            value={phone}
            maxLength={MAX.phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            aria-invalid={!!errors.phone}
          />
        </div>
        <Select label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option>Indeed</option>
          <option>Referral</option>
          <option>Walk-in</option>
          <option>LinkedIn</option>
          <option>Job fair</option>
          <option>Other</option>
        </Select>
        <Textarea
          label="Notes"
          rows={4}
          value={notes}
          maxLength={MAX.notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Years of experience, specialties, schedule constraints…"
          error={errors.notes}
          aria-invalid={!!errors.notes}
        />
      </div>
      {errors.form ? (
        <p role="alert" className="mt-4 text-[11px] text-[color:var(--rose)]">
          {errors.form}
        </p>
      ) : null}
      <div className="mt-5 flex gap-2">
        <Button loading={busy} onClick={save} icon={<Save className="h-3.5 w-3.5" />}>
          Add applicant
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
