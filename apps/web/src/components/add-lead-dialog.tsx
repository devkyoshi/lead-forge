"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { leadCreateSchema } from "@leadforge/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Form fields are strings; empty strings are dropped before validation.
const formSchema = z.object({
  name: z.string().min(1, "Required"),
  address: z.string(),
  phone: z.string(),
  category: z.string(),
  area: z.string(),
  websiteUrl: z.string(),
  email: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

export function AddLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", address: "", phone: "", category: "", area: "", websiteUrl: "", email: "" },
  });

  async function onSubmit(values: FormValues) {
    const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    const parsed = leadCreateSchema.safeParse(cleaned);
    if (!parsed.success) {
      toast.error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    try {
      await api("/leads", { method: "POST", json: parsed.data });
      toast.success("Lead created");
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create lead");
    }
  }

  const field = (name: keyof FormValues, label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} placeholder={placeholder} {...register(name)} />
      {errors[name] && <p className="text-sm text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          {field("name", "Business name")}
          {field("address", "Address")}
          <div className="grid grid-cols-2 gap-3">
            {field("phone", "Phone")}
            {field("email", "Email")}
            {field("category", "Category", "hotel, restaurant...")}
            {field("area", "Area")}
          </div>
          {field("websiteUrl", "Website URL", "https://")}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Create lead
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
