const fs = require('fs-extra')
const sanitize = require('sanitize-filename')
const path = require('path')
const json2md = require('json2md')
const downOverYoutubeDL = require('./helpers/downOverYoutubeDL')

const imgs2pdf = require('./helpers/imgs2pdf.js');
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())
const findChrome = require('chrome-finder')
const { NodeHtmlMarkdown } = require('node-html-markdown')
const cheerio = require('cheerio')
const req = require('requestretry')
const { orderBy, range, uniqBy } = require("lodash")
const j = req.jar()
const request = req.defaults({
    jar         : j,
    retryDelay  : 500,
    fullResponse: true
})

module.exports = class Crawler {

    static async getCourses(searchFromLocalFile) {
        if (searchFromLocalFile && await fs.exists(path.resolve(__dirname, '../json/search-courses.json'))) {
            console.log('LOAD FROM LOCAL SEARCH FILE');
            return require(path.resolve(__dirname, '../json/search-courses.json'))
        }
        // ms.add('search', { text: `Collecting data for search` });
        return Promise
            .resolve()
            .then(async () => {
                const { body } = await request(`https://academy.moralis.io/all-courses`)
                // console.log('body', body);
                const $ = cheerio.load(body)

                return $('.elementor-grid article.sfwd-courses.type-sfwd-courses h3.elementor-heading-title a')
                    .map((i, elem) => {
                        console.log('--',$(elem).text())
                        console.log($(elem).attr('href'));
                        return {
                            title: $(elem).text(),
                            value: $(elem).attr('href')
                        }
                    })
                    .get();
            })


    }

    delay(time) {
        return new Promise(function (resolve) {
            setTimeout(resolve, time)
        })
    }

    /**
     *
     * @param fn
     * @returns {Promise<*>}
     */
    async withBrowser(fn) {
        const browser = await puppeteer.launch({
            headless         : true, //run false for dev
            Ignorehttpserrors: true, // ignore certificate error
            waitUntil        : 'networkidle2',
            defaultViewport  : {
                width : 1920,
                height: 1080
            },
            timeout          : 60e3,
            args             : [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '-- Disable XSS auditor', // close XSS auditor
                '--no-zygote',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '-- allow running secure content', // allow unsafe content
                '--disable-webgl',
                '--disable-popup-blocking',
                //'--proxy-server= http://127.0.0.1:8080 '// configure agent
            ],
            executablePath   : findChrome(),
        })
        try {
            return await fn(browser)
        } finally {
            await browser.close()
        }
    }

    /**
     *
     * @param browser
     * @returns {(function(*): Promise<*|undefined>)|*}
     */
    withPage(browser) {
        return async fn => {
            const page = await browser.newPage()
            try {
                return await fn(page)
            } finally {
                await page.close()
            }
        }
    }

    /**
     *
     * @param page
     * @param link
     * @param url
     * @returns {Promise<*>}
     */
    async getCourseForDownload(page, link, { all }) {
        await page.goto('https://academy.moralis.io/all-courses', { waitUntil: 'networkidle0', timeout: 23e3 })
        //https://academy.moralis.io/courses/javascript-programming-for-blockchain-developers?ld-lesson-page=2
        const links = await page.evaluate(() => {
            return Array.from(
                document.querySelectorAll(
                    '.elementor-grid article.sfwd-courses.type-sfwd-courses h3.elementor-heading-title a'
                ), a => {
                    return ({
                        url  : a.href,
                        title: a.textContent//.querySelector('.school-url').innerItext
                    })
                })
        })

        return all ? links : [links.find(({ url }) => link.includes(url))]//series.find(link => url.includes(link.url))
    }

    /**
     *
     * @param page
     * @param opts
     * @returns {Promise<void>}
     */
    async loginAndRedirect(page, opts) {
        const login = 'https://academy.moralis.io/'//https://academy.moralis.io/login //opts.login
        await page.goto(login, { waitUntil: 'networkidle0' })

        await page.click('#guest_login_header > div > div > a')
        await this.delay(1e3)
        await page.waitForSelector('input[name="username"]')
        await page.focus('input[name="username"]')
        await page.keyboard.type(opts.email)
        await page.focus('input[name="password"]')

        await page.keyboard.type(opts.password)
        await page.click('button[name="uael-login-submit"]')
        await this.delay(5e3)
    }

    /**
     *
     * @param course
     * @param ms
     * @param index
     * @param total
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    extractVideos({
        course,
        ms,
        index,
        total
    }) {
        let series = sanitize(course.series.title)
        let position = course.index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${course.title}.mp4`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = series
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            title,
            position,
            downPath,
            vimeoUrl: course.vimeoUrl,
            markdown: course.markdown
        }
    }

    /**
     *
     * @param course
     * @returns <string> url
     * @private
     */
    async getSizeOfVideo(course) {
        const vimeoUrl = course.vimeoUrl

        try {
            const {
                      headers,
                      attempts: a
                  } = await request({
                url         : vimeoUrl, //v,
                json        : true,
                maxAttempts : 50,
                method      : 'HEAD',
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
            })

            return {
                url : vimeoUrl, //v
                size: headers['content-length']
            }
        } catch (err) {
            console.log('ERR::', err)
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err
        }
    };

    /**
     *
     * @param opts
     * @param url
     * @returns {Promise<*>}
     */
    async scrapeCourses(opts, url) {
        const { ms, all } = opts

        return await this.withBrowser(async (browser) => {
            return await this.withPage(browser)(async (page) => {

                await this.loginAndRedirect(page, opts)
                const courses = await this.getCourseForDownload(page, url, opts)
                /*const courses = [
                    {
                        "url": "https://academy.moralis.io/courses/fintech-101",
                        "title": "Master Fintech Business"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/us-taxation-of-digital-assets",
                        "title": "U.S. Taxation of Digital Assets"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/origintrail-101",
                        "title": "OriginTrail 101"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/origintrail-102",
                        "title": "OriginTrail 102"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/polkadot-101",
                        "title": "Master Polkadot Ecosystem"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/chainlink-101",
                        "title": "Program Oracles Using Chainlink"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/morpheus-network-101",
                        "title": "Supply Chains in Blockchain"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/ethereum-dapp-programming",
                        "title": "Build an NFT Marketplace"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/the-essential-blockchain-job-search-guide",
                        "title": "The essential blockchain job search guide"
                    },
                    {
                        "url": "https://academy.moralis.io/courses/study-guide",
                        "title": "Study Guide"
                    }
                ]*/

                //check which courses will be scraped
                await fs.ensureDir(path.resolve(__dirname, '../json'))
                await fs.writeFile(path.resolve(__dirname, `../json/courses-${new Date().toISOString()}.json`), JSON.stringify(courses, null, 2), 'utf8')

                /* if (!course) {
                    throw 'No course found!!!'
                } */
                // console.log('-------course', courses)

                const lessons = await Promise
                    .mapSeries(courses, async course => {
                        ms.add('info', { text: `Get course(s)` })
                        // ms.update('info', { text: `Checking ${course.url} for lessons` })
                        let lessons = await this.getLessons(page, course, 1, [], ms);
                        lessons = lessons.flat()

                        //check if there are additional pages or lessons
                        if (lessons.flat().length === 1) {
                            lessons = await this.checkForAdditionalLessons(page, lessons);
                        }

                        /*const lessons = [
                            {
                                url: 'https://academy.moralis.io/lessons/html-quiz',
                                title: 'HTML Quiz\n1 Quiz'
                            }
                        ]*/
                        ms.update('info', { text: `Checking ${course.url} for ${lessons.length} lessons` })
                        return await Promise
                            .map(lessons, async (lesson, index) => {
                                return await this.withPage(browser)(async (page) => {
                                    // console.log(`scraping: ${index} - ${lesson.url} - ${lesson.title}`);
                                    ms.update('info', { text: `scraping: ${index} - ${lesson.url} - ${lesson.title}` })

                                    await this.retry(async () => {
                                        //ensure that we are on the page
                                        await page.goto(lesson.url, { waitUntil: 'networkidle0' })
                                        await page.waitForSelector('.ld-focus-content h1')

                                    }, 6, 1e3, true);

                                    await this.isQuizPage(page);
                                    await this.makeScreenshot(page, course, index, lesson, opts)
                                    await this.createMarkdownFromHtml(page, course, index, lesson, opts);

                                    const vimeoUrl = await this.getVimeoUrl(page, lesson);
                                    // console.log('v', index, vimeoUrl);
                                    return this.extractVideos({
                                        course: {
                                            index,
                                            ...lesson,
                                            vimeoUrl,
                                            series: { ...course }
                                        },
                                        index,
                                        total : lessons.length
                                    })
                                })
                            }, { concurrency: 7 })
                            .then(c => c.flat()
                                .filter(Boolean)
                                .filter(item => item?.vimeoUrl)
                            )
                            .then(async items => {
                                ms.succeed('info', { text: `---- ${course.url} has ${items.length} lessons for download` })
                                await Promise.all([
                                    (async () => {
                                        //check what is scraped from pages
                                        await fs.ensureDir(path.resolve(__dirname), '../json'))
                                        await fs.writeFile(path.resolve(__dirname, `../json/courses-${new Date().toISOString()}.json`), JSON.stringify(items, null, 2), 'utf8')
                                    })(),
                                    (async () => {
                                        //download videos
                                        const prefix = all ? 'all-courses' : 'single-course'
                                        const filename = `${prefix}-${new Date().toISOString()}.json`
                                        await this.d(filename, prefix, items, { ms, ...opts });
                                    })(),
                                    (async () => {
                                        await imgs2pdf(
                                            path.join(opts.dir, course.title),
                                            path.join(opts.dir, course.title, `${course.title}.pdf`))
                                    })(),
                                ])

                                return items;
                            })
                    })
                    .then(c => c.flat()
                        .filter(Boolean)
                        .filter(item => item?.vimeoUrl)
                    )
                /* */
                // ms.succeed('info', { text: `Found: ${lessons.length} lessons` })
                await fs.ensureDir(path.resolve(__dirname, '../json'))
                await fs.writeFile(path.resolve(__dirname, `../json/test.json`), JSON.stringify(lessons, null, 2), 'utf8')

                return lessons
            })
        })
    }

    /**
     *
     * @param page
     * @param course
     * @param index
     * @param lesson
     * @param opts
     * @returns {Promise<void>}
     */
    async createMarkdownFromHtml(page, course, index, lesson, opts) {
        const nhm = new NodeHtmlMarkdown();
        let position = index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${lesson.title}`)
        let markdown = await page.evaluate(() => Array.from(document.body.querySelectorAll('.ld-focus-content'), txt => txt.outerHTML)[0]);
        await fs.ensureDir(path.join(opts.dir, course.title, 'markdown'))
        await fs.writeFile(path.join(opts.dir, course.title, 'markdown', `${title}.md`), nhm.translate(markdown), 'utf8')
        await this.delay(1e3)
    }

    /**
     *
     * @param page
     * @param lessons
     * @returns {Promise<*>}
     */
    async checkForAdditionalLessons(page, lessons) {
        await this.retry(async () => {
            //ensure that we are on the page
            await page.goto(lessons[0].url, { waitUntil: 'networkidle0' })
            // await page.waitForSelector('.ld-focus-content h1')

        }, 6, 1e3, true);
        return await page.evaluate(() => Array.from(document.querySelectorAll('.ld-lesson-topic-list .ld-table-list-items .ld-table-list-item a'), a => {
            return ({
                url  : a.href,
                title: a.innerText
                    .replaceAll('\\W+', '')
                    .replace('\\nStart\\n', '')
                    .replace(/(\r\n|\n|\r)/gm, '')
                    .replace(/[/\\?%*:|"<>]/g, '')
                    .trim()
            })
        }))
    }

    /**
     *
     * @param page
     * @param lesson
     * @returns {Promise<*>}
     */
    async getVimeoUrl(page, lesson) {
        return await this.retry(async () => {
            try {
                await page.waitForSelector('.ast-oembed-container iframe', {
                    timeout: 10e3
                })
                // console.log('ima iframe:', lesson.url);
                // Does exist
            } catch {
                // console.log('nema iframe:', lesson.url);
                return;
            }

            const iframeSrc = await page.evaluate(
                () => Array.from(document.body.querySelectorAll('.ast-oembed-container iframe'), ({ src }) => src)
            );
            if (iframeSrc[0].includes('www.youtube.com')) {
                console.log('-----we have youtube link', iframeSrc[0]);
                return iframeSrc[0]
            }
            const selectedVideo = await this.vimeoRequest(lesson.url, iframeSrc[0])
            return selectedVideo.url;

        }, 6, 1e3, true);
    }

    /**
     *
     * @param page
     * @returns {Promise<void>}
     */
    async isQuizPage(page) {
        await this.retry(async () => {
            try {
                await page.waitForSelector('.ld-table-list-item-quiz', {
                    timeout: 10e3
                })
                // Does exist
            } catch {
                //console.log('it is not quiz page, break:', lesson.url);
                return;
            }

            //go to quiz page
            await page.waitForSelector('.ld-table-list-item-quiz a', {
                timeout: 10e3
            })
            const href = await page.evaluate(() => Array.from(document.body.querySelectorAll('.ld-table-list-item-quiz a'), ({ href }) => href))

            // console.log('quiz url', href);
            await page.goto(href[0], { waitUntil: 'networkidle0' })
            await page.waitForSelector('.ld-focus-content h1')

            await this.delay(1e3)
            // document.querySelector("div.wpProQuiz_text > div > input")
            await page.waitForSelector('div.wpProQuiz_text > div > input')
            await page.click('div.wpProQuiz_text > div > input')
            await this.delay(1e3)

            await this.solveQuiz(page);

            await this.delay(1e3)
            await page.waitForSelector('input[name="reShowQuestion"]')
            await page.click('input[name="reShowQuestion"]')
            await this.delay(3e3)

            await page.waitForSelector('.wpProQuiz_list')

        }, 6, 1e3, true);
    }

    /**
     *
     * @param page
     * @param counter
     * @returns {Promise<*|undefined>}
     */
    async solveQuiz(page, counter = 1) {
        try {
            await page.waitForSelector(`div.wpProQuiz_quiz > ol > li:nth-child(${counter}) > input:nth-child(7)`, {
                visible: true,
                timeout: 10e3
            })
            await page.click(`div.wpProQuiz_quiz > ol > li:nth-child(${counter}) > input:nth-child(7)`, {
                visible: true,
            })
            await this.delay(1e3)
            return await this.solveQuiz(page, ++counter);
        } catch {
            // console.log('nema quiza:');
            return;
        }
    }

    /**
     *
     * @param page
     * @param course
     * @param pageCounter
     * @param lessons
     * @param ms
     * @returns {Promise<*[]|*>}
     */
    async getLessons(page, course, pageCounter, lessons = [], ms) {
        //console.log('getting lessons for page:', pageCounter);
        ms.update('info', { text: `Checking ${course.url} for ${lessons.flat().length} lessons for page: ${pageCounter}` })
        await page.goto(`${course.url}?ld-lesson-page=${pageCounter}`, { waitUntil: 'networkidle0' }) // wait until page load
        await page.waitForSelector('h1.elementor-heading-title', { timeout: 22e3 })

        const newLessons = await page.evaluate(() => {
            // const series = Array.from(document.body.querySelectorAll('h1.elementor-heading-title'), txt => txt.textContent)[0]
            const links = Array.from(document.querySelectorAll('a.ld-item-name'), a => {
                return ({
                    url  : a.href,
                    title: a.innerText
                        .replaceAll('\\W+', '')
                        .replace('\\nStart\\n', '')
                        .replace(/(\r\n|\n|\r)/gm, '')
                        .replace(/[/\\?%*:|"<>]/g, '')
                        .trim()
                })
            })
            return links
        })
        // return newLessons

        if (!newLessons.length) {

            //https://academy.moralis.io/courses/study-guide
            /*const studyGuide = [
                {
                    url  : 'https://academy.moralis.io/topic/lets-get-started',
                    title: 'Let’s get started!'
                },
                {
                    url  : 'https://academy.moralis.io/topic/identify-your-goals',
                    title: 'Identify your goals'
                },
                {
                    url  : 'https://academy.moralis.io/quizzes/assignment-write-down-your-goals',
                    title: 'Assignment Write down your goals'
                },
                {
                    url  : 'https://academy.moralis.io/topic/create-a-devoted-study-space',
                    title: 'Create a devoted study space'
                },
                {
                    url  : 'https://academy.moralis.io/topic/participate-in-our-amazing-community-forum',
                    title: 'Participate in our amazing community forum'
                },
                {
                    url  : 'https://academy.moralis.io/topic/stay-motivated',
                    title: 'Stay motivated'
                },
                {
                    url  : 'https://academy.moralis.io/topic/take-breaks',
                    title: 'Take breaks'
                },
                {
                    url  : 'https://academy.moralis.io/topic/consistency',
                    title: 'Consistency'
                }
            ]*/
            return lessons
        }

        lessons.push(newLessons)

        return await this.getLessons(page, course, ++pageCounter, lessons, ms);
    }

    /**
     *
     * @param page
     * @param course
     * @param index
     * @param lesson
     * @param opts
     * @returns {Promise<void>}
     */
    async makeScreenshot(page, course, index, lesson, opts) {
        //create a screenshot
        const $sec = await page.$('.ld-focus-content')
        if (!$sec) throw new Error(`Parsing failed!`)
        await this.delay(1e3) //5e3

        let series = sanitize(course.title)
        let position = index + 1
        let title = sanitize(`${String(position).padStart(2, '0')}-${lesson.title}.png`)
        // let downPath = `${course.series.id}-${series}`
        let downPath = series
        const dest = path.join(process.cwd(), opts.dir, downPath)
        fs.ensureDir(dest)
        await $sec.screenshot({
            path          : path.join(dest, title),
            type          : 'png',
            omitBackground: true,
            delay         : '500ms'
        })

        await this.delay(1e3)
    }

    /**
     *
     * @param filename
     * @param prefix
     * @param courses
     * @param opts
     * @returns {Promise<void>}
     */
    async d(filename, prefix, courses, opts) {
        const {
                  logger,
                  concurrency,
                  file,
                  filePath,
                  ms
              } = opts

        let cnt = 0
        await Promise.map(courses, async (course, index) => {
            if (course.done || course.vimeoUrl.includes('www.youtube.com')) {
                console.log('DONE for:', course.title)
                cnt++
                return
            }
            if (!course?.vimeoUrl) {
                throw new Error('Vimeo URL is not found')
            }

            if (!course?.downPath) {
                console.log('dest:', opts.dir, course.downPath)
            }
            const dest = path.join(opts.dir, course.downPath)
            fs.ensureDir(dest)

            const details = await this.getSizeOfVideo(course)
            await downOverYoutubeDL(details, path.join(dest, course.title), {
                downFolder: dest,
                index,
                ms
            })

            if (file) {
                courses[index].done = true
                await fs.writeFile(filePath, JSON.stringify(courses, null, 2), 'utf8')
            }
            cnt++
        }, {
            concurrency//: 1
        })

    }

    /**
     *
     * @param pageUrl
     * @param url
     * @returns {Promise<{size: string | undefined, url: *}>}
     */
    async vimeoRequest(pageUrl, url) {
        try {
            const { body, attempts } = await request({
                url,
                maxAttempts: 50,
                headers    : {
                    'Referer'   : "https://academy.moralis.io/",
                    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/27.0.1453.110 Safari/537.36'
                }
            })

            const v = this.findVideoUrl(body, pageUrl)
            // console.log('attempts', attempts);
            const { headers, attempts: a } = await request({
                url         : v,
                json        : true,
                maxAttempts : 50,
                method      : "HEAD",
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
                'headers'   : {
                    'Referer': "https://academy.moralis.io/"
                }
            })

            return {
                url : v,
                size: headers['content-length']
            };
        } catch (err) {
            console.log('ERR::', err);
            console.log('err:: pageUrl:', pageUrl, 'url:', url);
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err;
        }
    }

    /**
     *
     * @param str
     * @param pageUrl
     * @returns {null|*}
     */
    findVideoUrl(str, pageUrl) {
        const regex = /(?:config = )(?:\{)(.*(\n.*?)*)(?:\"\})/gm;
        let res = regex.exec(str);
        if (res !== null) {
            if (typeof res[0] !== "undefined") {
                let config = res[0].replace('config = ', '');
                config = JSON.parse(config);
                let progressive = config.request.files.progressive;
                let video = orderBy(progressive, ['width'], ['desc'])[0];
                return video.url;
            }
        }

        return null;
    }

    /**
     *
     * @param file
     * @param logger
     * @param prefix
     * @param courses
     * @param filename
     * @returns {Promise<void>}
     */
    async writeVideosIntoFile(file, logger, prefix, courses, filename) {
        if (!file) {
            await fs.writeFile(`./json/${filename}`, JSON.stringify(courses, null, 2), 'utf8')
            logger.info(`json file created with lessons ...`)
        }
        logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${courses.length})`)
        //return courses
    }

    /**
     * Retries the given function until it succeeds given a number of retries and an interval between them. They are set
     * by default to retry 5 times with 1sec in between. There's also a flag to make the cooldown time exponential
     * @author Daniel Iñigo <danielinigobanos@gmail.com>
     * @param {Function} fn - Returns a promise
     * @param {Number} retriesLeft - Number of retries. If -1 will keep retrying
     * @param {Number} interval - Millis between retries. If exponential set to true will be doubled each retry
     * @param {Boolean} exponential - Flag for exponential back-off mode
     * @return {Promise<*>}
     */
    async retry(fn, retriesLeft = 5, interval = 1000, exponential = false) {
        try {
            const val = await fn()
            return val
        } catch (error) {
            if (retriesLeft) {
                console.log('.... retrying left (' + retriesLeft + ')')
                console.log('retrying err', error)
                await new Promise(r => setTimeout(r, interval))
                return this.retry(fn, retriesLeft - 1, exponential ? interval*2 : interval, exponential)
            } else {
                console.log('Max retries reached')
                throw error
                //throw new Error('Max retries reached');
            }
        }
    }
}

