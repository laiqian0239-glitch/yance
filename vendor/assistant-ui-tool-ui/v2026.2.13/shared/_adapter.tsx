import * as React from "react";

type ClassValue = string | number | false | null | undefined | ClassValue[];

function appendClassValue(output: string[], value: ClassValue): void {
  if (Array.isArray(value)) {
    for (const item of value) appendClassValue(output, item);
    return;
  }
  if (value === false || value === null || value === undefined) return;
  const text = String(value).trim();
  if (text) output.push(text);
}

export function cn(...values: ClassValue[]): string {
  const output: string[] = [];
  for (const value of values) appendClassValue(output, value);
  return output.join(" ");
}

export type ToolUiButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
};

export const Button = React.forwardRef<HTMLButtonElement, ToolUiButtonProps>(
  function ToolUiButton({ variant: _variant, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} {...props} />;
  },
);

export const Separator = React.forwardRef<
  HTMLHRElement,
  React.HTMLAttributes<HTMLHRElement>
>(function ToolUiSeparator(props, ref) {
  return <hr ref={ref} {...props} />;
});
