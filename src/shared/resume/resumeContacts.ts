/**
 * 从简历纯文本里抽出高置信的电话、邮箱、生日。
 * 只补模型没填上的空位，不覆盖模型已经给出的内容。
 */
import type { ProfileData } from '../types/profile';

/** 本地抽出的联系字段 */
export interface ResumeContactHits {
  phone: string;
  email: string;
  birthday: string;
}

/**
 * 在正文里找手机号、邮箱，以及紧挨「出生」的日期。
 */
export function extractResumeContacts(resumeText: string): ResumeContactHits {
  const emailMatch = resumeText.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  );
  const compactDigits = resumeText.replace(/[\s\-]/g, '');
  const phoneMatch = compactDigits.match(/1[3-9]\d{9}/);
  const birthdayMatch = resumeText.match(
    /(?:出生日期|出生年月|生日|出生)[:：\s]*(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/,
  );
  const birthday = birthdayMatch
    ? `${birthdayMatch[1]}-${birthdayMatch[2].padStart(2, '0')}-${birthdayMatch[3].padStart(2, '0')}`
    : '';
  return {
    phone: phoneMatch?.[0] ?? '',
    email: emailMatch?.[0] ?? '',
    birthday,
  };
}

/**
 * 把本地抽出的电话、邮箱、生日填进识别结果里仍为空的基本信息。
 */
export function overlayLocalResumeContacts(
  profilePatch: ProfileData,
  resumeText: string,
): ProfileData {
  const nextPatch = structuredClone(profilePatch);
  const contacts = extractResumeContacts(resumeText);
  if (!nextPatch.basic.phone.trim() && contacts.phone) {
    nextPatch.basic.phone = contacts.phone;
  }
  if (!nextPatch.basic.email.trim() && contacts.email) {
    nextPatch.basic.email = contacts.email;
  }
  if (!(nextPatch.basic.birthday ?? '').trim() && contacts.birthday) {
    nextPatch.basic.birthday = contacts.birthday;
  }
  return nextPatch;
}
