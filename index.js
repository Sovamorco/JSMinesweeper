const http = require("http")
const path = require("path")
const express = require("express")

const { createNoGuessGame } = require("./minesweeper/client/minesweeperGame")

let CONFIG_PATH = "config.dev.json"
if (process.env.CONFIG_PATH !== undefined) {
    CONFIG_PATH = process.env.CONFIG_PATH
}

const config = require(path.resolve(__dirname, CONFIG_PATH))

const shutdownTimeout = 30 * 1000

const app = express()
const server = app.listen(config.port, function () {
    console.log(`HTTP server listening on port ${config.port}`)
})

app.use(express.json())

app.get("/ping", async (_, res) => {
    await res.send("pong")
})

app.post("/generate", async (req, res) => {
    try {
        const game = await createNoGuessGame({
            h: req.body.h,
            w: req.body.w,
            mines: req.body.mines,
            firstClickY: req.body.firstClickY,
            firstClickX: req.body.firstClickX,
            maxLoops: req.body.maxLoops,
        })

        res.send(convertGame(game))
    } catch (err) {
        console.error(err)

        res.status(500).send()
    }
})

function convertGame(game) {
    const res = []

    for (let y = 0; y < game.height; y++) {
        res.push([])

        for (let x = 0; x < game.width; x++) {
            let v = false
            if (game.getTile(yx_to_index(y, x, game.width)).isBomb()) {
                v = true
            }

            res[y].push(v)
        }
    }

    return JSON.stringify(res)
}

function yx_to_index(y, x, width) {
    return y * width + x
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

function shutdown() {
    console.log("Shutting down")

    server.close(function () {
        console.log("Shut down")
        process.exit(0)
    })

    setTimeout(() => {
        process.exit(1)
    }, shutdownTimeout)
}
