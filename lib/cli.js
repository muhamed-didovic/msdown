#!/usr/bin/env node
const meow = require('meow')
const prompts = require('prompts')
const createLogger = require('./helpers/createLogger')
const { scrape } = require('.')
const path = require('path')
const fs = require('fs-extra')
const isValidPath = require('is-valid-path')
const isEmail = require('util-is-email').default
// const Fuse = require('fuse.js')

const cli = meow(`
Usage
    $ msdown [CourseUrl]

Options
    --all, -a           Get all courses from particular school or provider.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --concurrency, -c

Examples
    $ msdown
    $ msdown -a
    $ msdown [url] [-l url...] [-e user@gmail.com] [-p password] [-d dirname] [-c number] [-f path-to-file]
`, {
    hardRejection: false,
    flags: {
        help       : { alias: 'h' },
        version    : { alias: 'v' },
        all        : {
            type : 'boolean',
            alias: 'a'
        },
        email      : {
            type : 'string',
            alias: 'e'
        },
        password   : {
            type : 'string',
            alias: 'p'
        },
        directory  : {
            type : 'string',
            alias: 'd'
        },
        concurrency: {
            type   : 'number',
            alias  : 'c',
            default: 10
        },
        file       : {
            type : 'boolean',
            alias: 'f'
        }
    }
})

const logger = createLogger()
// const errorHandler = err => (console.log('\u001B[1K'), logger.fail(String(err)), process.exit(1))
// const errorHandler = err => (console.error(err), logger.fail(String(err)), process.exit(1))
const errorHandler = err => (console.error('MAIN errorr:', err), process.exit(1))//logger.fail(`HERE IS THE ERROR in string: ${String(err}`))
const askOrExit = question => prompts({ name: 'value', ...question }, { onCancel: () => process.exit(0) }).then(r => r.value)
const folderContents = async (folder) => {
    const files = await fs.readdir(folder)
    if (!files.length) {
        return console.log('No files found')
    }
    // console.log(`found some files: ${files.length} in folder: ${folder}`);
    return files.map(file => ({
        title: file,
        value: path.join(folder, file)
    }))
}

(async () => {
    const { flags, input } = cli
    let all = flags.all
    let courseUrl;
    if (all || (input.length === 0 && await askOrExit({
        type: 'confirm',
        message: 'Do you want all courses?',
        initial: false
    }))) {
        all = true;
    } else {
        if (input.length === 0) {
            input.push(await askOrExit({
                type   : 'text',
                message: 'Enter url for download.',
                // initial : 'https://academy.moralis.io/all-courses',
                // initial: 'https://academy.moralis.io/courses/javascript-programming-for-blockchain-developers',
                initial: 'https://academy.moralis.io/courses/create-your-metaverse',
                validate: value => value.includes('moralis.io') ? true : 'Url is not valid'
            }))
        }
        courseUrl = input[0]
    }

    /*const all = flags.all || await askOrExit({
        type   : 'confirm',
        message: 'Do you want all courses from this school or just single course?',
        initial: false
    })*/

    /*if (input.length === 0) {
        input.push(await askOrExit({
            type   : 'text',
            message: 'Enter url for download.',
            // initial : 'https://academy.moralis.io/all-courses',
            initial: 'https://academy.moralis.io/courses/javascript-programming-for-blockchain-developers',
            validate: value => value.includes('moralis.io') ? true : 'Url is not valid'
        }))
    }*/

    /*const login = flags.login || await askOrExit({
        type    : 'text',
        message : 'Enter login page or url',
        initial: 'https://academy.moralis.io/login',
        validate: value => value.includes('moralis.io') ? true : 'Url is not valid'
    })*/

    const file = flags.file || await askOrExit({
        type   : 'confirm',
        message: 'Do you want download from a file',
        initial: false
    })

    const filePath = flags.file || await askOrExit({
        type    : file ? 'autocomplete' : null,
        message : `Enter a file path eg: ${path.resolve(process.cwd(), 'json/*.json')} `,
        choices : await folderContents(path.resolve(process.cwd(), 'json')),
        validate: isValidPath
    })

    const email = flags.email || await askOrExit({
        type    : 'text',
        message : 'Enter email',
        validate: value => value.length < 5 ? 'Sorry, enter correct email' : true
    })
    const password = flags.password || await askOrExit({
        type    : 'text',
        message : 'Enter password',
        validate: value => value.length < 5 ? 'Sorry, password must be longer' : true
    })
    const dir = flags.directory || path.resolve(await askOrExit({
        type    : 'text',
        message : `Enter a directory to save (eg: ${path.resolve(process.cwd())})`,
        initial : path.resolve(process.cwd(), 'videos/'),
        validate: isValidPath
    }))

    const concurrency = flags.concurrency || await askOrExit({
        type   : 'number',
        message: 'Enter concurrency',
        initial: 10
    })
    // const dir = await askSaveDirOrExit()

    scrape({
        all,
        email,
        password,
        logger,
        dir,
        concurrency,
        file,
        filePath,
        courseUrl
        //login
    }).catch(errorHandler)
})()
