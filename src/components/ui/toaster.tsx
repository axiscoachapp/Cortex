import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, duration, ...props }) {
        const error = variant === "destructive";
        return (
          <Toast
            key={id}
            variant={variant}
            // An error stays until the person closes it and is announced at once; other
            // notices close by themselves and wait for the screen reader to finish.
            duration={duration ?? (error ? Infinity : undefined)}
            type={error ? "foreground" : "background"}
            {...props}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
