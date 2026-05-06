const MAX_WALK_DEPTH = 8;
const HASH_LIKE_REGEX = /^[a-z0-9_-]{6,}$/;

function hasVowels(s: string): boolean {
  return /[aeiouy]/i.test(s);
}

function isHashLikeClass(cls: string): boolean {
  return HASH_LIKE_REGEX.test(cls) && !hasVowels(cls);
}

function getSegment(el: Element): string {
  // Priority 1: data-nodd-id
  const noddId = el.getAttribute('data-nodd-id');
  if (noddId) return `${el.tagName.toLowerCase()}[data-nodd-id="${noddId}"]`;

  // Priority 2: data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) return `${el.tagName.toLowerCase()}[data-testid="${testId}"]`;

  // Priority 3: unique id
  const id = el.id;
  if (id && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
    return `#${CSS.escape(id)}`;
  }

  // Priority 4: role
  const role = el.getAttribute('role');

  // Priority 5: tag.classes:nth-of-type
  const tag = el.tagName.toLowerCase();
  const classes = [...el.classList]
    .filter(c => !isHashLikeClass(c))
    .map(c => `.${CSS.escape(c)}`)
    .join('');

  const parent = el.parentElement;
  let nth = '';
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      s => s.tagName === el.tagName,
    );
    if (siblings.length > 1) {
      nth = `:nth-of-type(${siblings.indexOf(el) + 1})`;
    }
  }

  if (role) {
    return `${tag}[role="${role}"]${classes}${nth}`;
  }

  return `${tag}${classes}${nth}`;
}

export function buildSelector(target: Element): string {
  const segments: string[] = [];
  let el: Element | null = target;
  let depth = 0;

  while (el && el !== document.body && el !== document.documentElement && depth < MAX_WALK_DEPTH) {
    segments.unshift(getSegment(el));
    const partial = segments.join(' > ');
    if (document.querySelectorAll(partial).length === 1) {
      return partial;
    }
    el = el.parentElement;
    depth++;
  }

  return segments.join(' > ');
}
