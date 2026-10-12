"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, Loader2, Radar } from "lucide-react";
import { loginSchema, type LoginInput } from "@leadforge/shared";
import { api } from "@/lib/api";
import { DevMenu } from "@/components/dev-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const POINTS = [
  "Find local businesses with no website or a poor one",
  "Personalised proposals that cite their real website issues",
  "Compliant sending with unsubscribe, limits and follow-ups",
];

export default function LoginPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    try {
      await api("/auth/login", { method: "POST", json: values });
      router.replace("/leads");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-violet-400/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
            <Radar className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">LeadForge</span>
        </div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Turn local businesses without a website into clients.</h2>
          <ul className="space-y-3 text-indigo-100">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check className="size-3" />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-indigo-200/80">Discover, audit, score, personalise, send, and track every lead to a signed project.</p>
      </section>

      {/* Form */}
      <section className="relative flex items-center justify-center p-6 sm:p-10">
        <div className="absolute right-4 top-4">
          <DevMenu
            onFillLogin={(email, password) => {
              setValue("email", email, { shouldValidate: true });
              setValue("password", password, { shouldValidate: true });
            }}
          />
        </div>
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm lg:hidden">
              <Radar className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your LeadForge workspace.</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" className="h-10" aria-invalid={!!errors.email} {...register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" className="h-10" aria-invalid={!!errors.password} {...register("password")} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
