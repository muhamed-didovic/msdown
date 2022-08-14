# Downloader and scraper for moralis.io for pro members

[![npm](https://badgen.net/npm/v/msdown)](https://www.npmjs.com/package/msdown)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fmuhamed-didovic%2Fmsdown&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false)](https://hits.seeyoufarm.com)
[![license](https://flat.badgen.net/github/license/muhamed-didovic/tcdown)](https://github.com/muhamed-didovic/tcdown/blob/master/LICENSE)

## Install
```sh
npm i -g msdown
```

#### without Install
```sh
npx msdown
```

## CLI
```sh
Usage
    $ msdown [CourseUrl]

Options
    --all, -a           Get all courses from particular school or provider.
    --login, -l         Your login url with login form.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --concurrency, -c

Examples
    $ msdown
    $ msdown -a
    $ msdown [url] [-l url...] [-e user@gmail.com] [-p password] [-d dirname] [-c number] [-f path-to-file]
```

## License
MIT
