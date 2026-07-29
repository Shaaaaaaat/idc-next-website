import { NextResponse } from "next/server";

export type MobileErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INTERNAL_ERROR";

const MESSAGE_BY_CODE: Record<MobileErrorCode, string> = {
  BAD_REQUEST: "Malformed request",
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "Access denied",
  INVALID_INPUT: "Invalid input",
  INTERNAL_ERROR: "Internal server error",
};

export function mobileError(
  code: MobileErrorCode,
  status: number,
  message = MESSAGE_BY_CODE[code]
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function mobileJson<T extends Record<string, unknown>>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}
