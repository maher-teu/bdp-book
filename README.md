# The BDP Method - web reader

Everything in this folder IS the website. Upload it, and the book is live.

The database, the security, your admin access, and the reader dashboard are already
built and running in your Supabase account. Nothing to set up there.

## What to do
Follow the numbered steps Claude gave you in the chat. Two things happen:
1. You put this folder online with GitHub and Vercel. That gives you a web address.
2. You paste that web address into Supabase so the sign in emails work.

That is it. There is no third step.

## Files
index.html   the page
styles.css   the look
app.js       the brain: sign in, progress, highlights, notes, checkboxes, dashboard
book.json    the whole book, all 11 sections
img          the 45 illustrations
vercel.json  makes it load fast

## Your admin access
maher@puzzlesmarketing.co is already the admin. Sign in with it and a Dashboard
button appears in the top right. To add someone else later, run this in the
Supabase SQL Editor:

insert into book_admins (email) values ('their@email.com');
