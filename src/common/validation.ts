import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

/** class-validator cheklov nomlari → o'zbekcha xabar. `{field}` maydon nomi, `{c}` cheklov argumenti. */
const MESSAGES: Record<string, (field: string, c: unknown[]) => string> = {
  isString: (f) => `${f}: matn bo'lishi kerak`,
  isNotEmpty: (f) => `${f}: bo'sh bo'lmasin`,
  isInt: (f) => `${f}: butun son bo'lishi kerak`,
  isNumber: (f) => `${f}: son bo'lishi kerak`,
  isBoolean: (f) => `${f}: ha/yo'q (true/false) bo'lishi kerak`,
  isArray: (f) => `${f}: ro'yxat bo'lishi kerak`,
  isUuid: (f) => `${f}: identifikator (UUID) bo'lishi kerak`,
  isEmail: (f) => `${f}: email noto'g'ri`,
  isIn: (f, c) => `${f}: faqat ${(c[0] as unknown[]).map(String).join(', ')} bo'lishi mumkin`,
  min: (f, c) => `${f}: kamida ${c[0]} bo'lsin`,
  max: (f, c) => `${f}: ko'pi bilan ${c[0]} bo'lsin`,
  minLength: (f, c) => `${f}: kamida ${c[0]} ta belgi`,
  maxLength: (f, c) => `${f}: ko'pi bilan ${c[0]} ta belgi`,
  arrayMinSize: (f, c) => `${f}: kamida ${c[0]} ta element`,
  arrayMaxSize: (f, c) => `${f}: ko'pi bilan ${c[0]} ta element`,
  arrayUnique: (f) => `${f}: takror elementlar bor`,
  matches: (f) => `${f}: format noto'g'ri`,
  whitelistValidation: (f) => `${f}: bunday maydon yo'q`,
  nestedValidation: (f) => `${f}: ichki qiymat noto'g'ri`,
};

/** Validatsiya xatolarini tekis ro'yxatga yig'adi (ichma-ich DTO lar uchun `lines.0.qty` kabi). */
export function flattenValidation(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const [key, original] of Object.entries(e.constraints ?? {})) {
      const custom = original && !/^[a-zA-Z0-9_.]+ (must|should|contains|has)/.test(original) ? original : null; // dekoratorda berilgan o'zbekcha xabar
      const fn = MESSAGES[key];
      out.push({ field, message: custom ?? (fn ? fn(field, e.contexts?.[key] ? [] : constraintArgs(e, key)) : original ?? `${field}: qiymat noto'g'ri`) });
    }
    if (e.children?.length) out.push(...flattenValidation(e.children, field));
  }
  return out;
}

function constraintArgs(e: ValidationError, key: string): unknown[] {
  // class-validator argumentlarni saqlamaydi; xabardan raqamni ajratib olamiz ("must not be less than 8")
  const msg = e.constraints?.[key] ?? '';
  const m = msg.match(/(-?\d+(?:\.\d+)?)/);
  if (key === 'isIn') {
    const list = msg.match(/following values: (.+)$/);
    return [list ? list[1].split(',').map((s) => s.trim()) : []];
  }
  return m ? [m[1]] : [];
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) => {
      const list = flattenValidation(errors);
      return new BadRequestException({ message: list.map((x) => x.message), errors: list });
    },
  });
}
