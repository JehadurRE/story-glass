const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const res = await fetch('https://www.facebook.com/awomensoul', {
  headers: { 'User-Agent': UA_MOBILE, Accept: 'text/html' },
  redirect: 'follow',
});
const html = await res.text();
console.log('status', res.status, 'final', res.url, 'len', html.length);
console.log(html.slice(0, 3000));
console.log('---META---');
for (const m of html.matchAll(/<meta[^>]+>/gi)) {
  if (/og:|description|redirect|refresh/i.test(m[0])) console.log(m[0].slice(0, 220));
}
console.log('---IDS---');
const ids = [...new Set([...html.matchAll(/\b(\d{8,})\b/g)].map((m) => m[1]))].slice(0, 20);
console.log(ids);
console.log('has login', /log in|log into|login/i.test(html));
