function normalizeTitle(value) {
  return String(value || '').trim();
}

function buildDefaultApplicationTitle(country) {
  const countryName = normalizeTitle(country) || '目的地';
  return `${countryName}申请表`;
}

function stripCompanionSuffix(title) {
  return normalizeTitle(title).replace(/_\d+$/, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCompanionApplicationTitle(sourceTitle, applications) {
  const baseTitle = stripCompanionSuffix(sourceTitle) || '同行人表格';
  const usedNumbers = (applications || []).reduce((result, item) => {
    const title = normalizeTitle(item.title);
    const match = title.match(new RegExp(`^${escapeRegExp(baseTitle)}_(\\d+)$`));
    if (match) result.push(Number(match[1]));
    return result;
  }, []);
  let next = 1;
  while (usedNumbers.indexOf(next) >= 0) next += 1;
  return `${baseTitle}_${next}`;
}

function buildCopyApplicationTitle(sourceTitle, applications) {
  const baseTitle = normalizeTitle(sourceTitle) || '申请表';
  const copyTitle = `${baseTitle}_copy`;
  const existingTitles = (applications || []).map((item) => normalizeTitle(item.title));
  if (existingTitles.indexOf(copyTitle) < 0) return copyTitle;

  let next = 2;
  while (existingTitles.indexOf(`${copyTitle}_${next}`) >= 0) next += 1;
  return `${copyTitle}_${next}`;
}

module.exports = {
  normalizeTitle,
  buildDefaultApplicationTitle,
  buildCompanionApplicationTitle,
  buildCopyApplicationTitle,
};
