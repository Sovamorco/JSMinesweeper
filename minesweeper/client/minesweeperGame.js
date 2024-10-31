const { Board } = require("./board")
const { solver, PLAY_STYLE_NOFLAGS } = require("./solver")
const { ACTION_FLAG, ACTION_CHORD, WON, LOST, IN_PLAY } = require("./consts")

async function createNoGuessGame({ h, w, mines, firstClickY, firstClickX, maxLoops }) {
    const startTime = Date.now()

    let won = false
    let loopCheck = 0

    let game

    while (!won && loopCheck < maxLoops) {
        const board = new Board(h, w, mines)

        game = new ServerGame(h, w, mines, board.xy_to_index(firstClickX, firstClickY))

        const tile = game.getTile(game.startIndex)

        let revealedTiles = game.clickTile(tile)
        applyResults(board, revealedTiles)

        let guessed = false
        while (revealedTiles.header.status == IN_PLAY && loopCheck < maxLoops && !guessed) {
            loopCheck++

            const reply = await solver(board)

            const fillers = reply.fillers
            for (let i = 0; i < fillers.length; i++) {
                const filler = fillers[i]

                revealedTiles = game.fix(filler)

                applyResults(board, revealedTiles)
            }

            let actions
            if (fillers.length > 0) {
                actions = []
            } else {
                actions = reply.actions
            }

            for (let i = 0; i < actions.length; i++) {
                const action = actions[i]

                if (action.action == ACTION_CHORD) {
                    console.log("Got a chord request!")
                } else if (action.action != ACTION_FLAG) {
                    // otherwise we're trying to clear

                    if (action.prob != 1) {
                        // do no more actions after a guess
                        guessed = true
                        break
                    }

                    const tile1 = game.getTile(board.xy_to_index(action.x, action.y))

                    revealedTiles = game.clickTile(tile1)

                    if (revealedTiles.header.status != IN_PLAY) {
                        // if won or lost nothing more to do
                        break
                    }

                    applyResults(board, revealedTiles)
                }
            }
        }

        if (revealedTiles.header.status == WON) {
            won = true
        }
    }

    if (!won) {
        throw new Error("ran out of iterations")
    }

    console.log(`Generated game in ${loopCheck} iterations (${(Date.now() - startTime) / 1000}s)`)

    game.reset()

    return game
}

function applyResults(board, revealedTiles) {
    for (let i = 0; i < revealedTiles.tiles.length; i++) {
        const target = revealedTiles.tiles[i]

        const index = target.index
        const action = target.action

        const tile = board.getTile(index)

        if (action == 1) {
            // reveal value on tile
            tile.setValue(target.value)
            //console.log("Setting Tile " + target.index + " to " + target.value);
        } else if (action == 2) {
            // add or remove flag
            if (target.flag != tile.isFlagged()) {
                tile.toggleFlag()
                if (tile.isFlagged()) {
                    board.bombs_left--
                } else {
                    board.bombs_left++
                }
            }
        } else if (action == 3) {
            // a tile which is a mine (these get returned when the game is lost)
            board.setGameLost()
            tile.setBomb(true)
        } else if (action == 4) {
            // a tile which is a mine and is the cause of losing the game
            board.setGameLost()
            tile.setBombExploded()
        } else if (action == 5) {
            // a which is flagged but shouldn't be
            tile.setBomb(false)
        } else {
            console.log("action " + action + " is not valid")
        }
    }
}

/**
 * This describes a game of minesweeper
 */
class ServerGame {
    constructor(h, w, mines, index) {
        this.created = new Date()
        this.lastAction = this.created

        this.gameType = "zero"
        this.width = w
        this.height = h
        this.num_bombs = mines
        this.cleanUp = false
        this.actions = 0
        this.cleared3BV = 0
        this.startIndex = index

        this.tiles = []
        this.started = false

        this.adj_offset = []
        this.adj_offset[0] = -this.width - 1
        this.adj_offset[1] = -this.width
        this.adj_offset[2] = -this.width + 1
        this.adj_offset[3] = -1
        this.adj_offset[4] = 1
        this.adj_offset[5] = +this.width - 1
        this.adj_offset[6] = +this.width
        this.adj_offset[7] = +this.width + 1

        const exclude = {}
        exclude[index] = true
        var excludeCount = 1

        if (this.gameType == "zero") {
            for (let adjIndex of this.getAdjacentIndex(index)) {
                exclude[adjIndex] = true
                excludeCount++
            }
        }

        if (this.width * this.height - excludeCount < this.num_bombs) {
            this.num_bombs = this.width * this.height - excludeCount
            console.log("WARN: Too many mines to be placed! Reducing mine count to " + this.num_bombs)
        }

        this.tilesLeft = this.width * this.height - this.num_bombs

        this.init_tiles(exclude)

        this.value3BV = this.calculate3BV()
    }

    reset() {
        this.cleanUp = false
        this.actions = 0
        this.cleared3BV = 0
        this.started = false
        this.tilesLeft = this.width * this.height - this.num_bombs

        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i]
            tile.reset()
        }

        this.value3BV = this.calculate3BV()
    }

    getTile(index) {
        return this.tiles[index]
    }

    clickTile(tile) {
        const reply = { header: {}, tiles: [] }

        if (tile.isBomb()) {
            this.actions++

            reply.header.status = LOST
            tile.exploded = true
        } else {
            if (tile.isCovered() && !tile.isFlagged()) {
                this.actions++

                const tilesToReveal = []
                tilesToReveal.push(tile)
                return this.reveal(tilesToReveal)
            } else {
                reply.header.status = IN_PLAY
            }
        }

        return reply
    }

    reveal(firstTiles) {
        const toReveal = []
        let soFar = 0

        const reply = { header: {}, tiles: [] }

        for (let firstTile of firstTiles) {
            firstTile.setNotCovered()
            if (firstTile.is3BV) {
                this.cleared3BV++
            }
            toReveal.push(firstTile)
        }

        let safety = 100000

        while (soFar < toReveal.length) {
            const tile = toReveal[soFar]

            reply.tiles.push({ action: 1, index: tile.getIndex(), value: tile.getValue() })
            this.tilesLeft--

            // if the value is zero then for each adjacent tile not yet revealed add it to the list
            if (tile.getValue() == 0) {
                for (let adjTile of this.getAdjacent(tile)) {
                    if (adjTile.isCovered() && !adjTile.isFlagged()) {
                        // if not covered and not a flag
                        adjTile.setNotCovered() // it will be uncovered in a bit
                        if (adjTile.is3BV) {
                            this.cleared3BV++
                        }
                        toReveal.push(adjTile)
                    }
                }
            }

            soFar++
            if (safety-- < 0) {
                console.log("Safety limit reached !!")
                break
            }
        }

        // if there are no tiles left to find then set the remaining tiles to flagged and we've won
        if (this.tilesLeft == 0) {
            for (let i = 0; i < this.tiles.length; i++) {
                const tile = this.tiles[i]
                if (tile.isBomb() && !tile.isFlagged()) {
                    tile.toggleFlag()
                    reply.tiles.push({ action: 2, index: i, flag: tile.isFlagged() }) // auto set remaining flags
                }
            }

            reply.header.status = WON
        } else {
            reply.header.status = IN_PLAY
        }

        return reply
    }

    // fix modify the mines around this withness to make it a safe move
    fix(filler) {
        const reply = { header: {}, tiles: [] }
        reply.header.status = IN_PLAY

        const tile = this.getTile(filler.index)

        if (filler.fill) {
            if (!tile.isBomb()) {
                // if filling and not a bomb add a bomb
                tile.makeBomb()
                this.num_bombs++
                for (let adjTile1 of this.getAdjacent(tile)) {
                    adjTile1.value += 1
                    if (!adjTile1.isCovered()) {
                        reply.tiles.push({ action: 1, index: adjTile1.getIndex(), value: adjTile1.getValue() })
                    }
                }
            }
        } else {
            if (tile.isBomb()) {
                // if emptying and is a bomb - remove it
                tile.isbomb = false
                this.num_bombs--
                for (let adjTile1 of this.getAdjacent(tile)) {
                    adjTile1.value -= 1
                    if (!adjTile1.isCovered()) {
                        reply.tiles.push({ action: 1, index: adjTile1.getIndex(), value: adjTile1.getValue() })
                    }
                }
            }
        }

        return reply
    }

    // builds all the tiles and assigns bombs to them
    init_tiles(to_exclude) {
        // create the tiles
        const indices = []
        for (let i = 0; i < this.width * this.height; i++) {
            this.tiles.push(new ServerTile(i))

            if (!to_exclude[i]) {
                indices.push(i)
            }
        }

        shuffle(indices)

        // allocate the bombs and calculate the values
        for (let i = 0; i < this.num_bombs; i++) {
            const index = indices[i]
            const tile = this.tiles[index]

            tile.makeBomb()
            for (let adjTile of this.getAdjacent(tile)) {
                adjTile.value += 1
            }
        }
    }

    // returns all the tiles adjacent to this tile
    getAdjacent(tile) {
        const index = tile.getIndex()

        const col = index % this.width
        const row = Math.floor(index / this.width)

        const first_row = Math.max(0, row - 1)
        const last_row = Math.min(this.height - 1, row + 1)

        const first_col = Math.max(0, col - 1)
        const last_col = Math.min(this.width - 1, col + 1)

        const result = []

        for (let r = first_row; r <= last_row; r++) {
            for (let c = first_col; c <= last_col; c++) {
                const i = this.width * r + c
                if (i != index) {
                    result.push(this.tiles[i])
                }
            }
        }

        return result
    }

    // returns all the tiles adjacent to this tile
    getAdjacentIndex(index) {
        const col = index % this.width
        const row = Math.floor(index / this.width)

        const first_row = Math.max(0, row - 1)
        const last_row = Math.min(this.height - 1, row + 1)

        const first_col = Math.max(0, col - 1)
        const last_col = Math.min(this.width - 1, col + 1)

        const result = []

        for (let r = first_row; r <= last_row; r++) {
            for (let c = first_col; c <= last_col; c++) {
                const i = this.width * r + c
                if (i != index) {
                    result.push(i)
                }
            }
        }

        return result
    }

    calculate3BV() {
        let value3BV = 0

        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i]

            if (!tile.used3BV && !tile.isBomb() && tile.getValue() == 0) {
                value3BV++
                tile.used3BV = true
                tile.is3BV = true

                const toReveal = [tile]
                let soFar = 0

                let safety = 100000

                while (soFar < toReveal.length) {
                    const tile1 = toReveal[soFar]

                    // if the value is zero then for each adjacent tile not yet revealed add it to the list
                    if (tile1.getValue() == 0) {
                        for (let adjTile of this.getAdjacent(tile1)) {
                            if (!adjTile.used3BV) {
                                adjTile.used3BV = true

                                if (!adjTile.isBomb() && adjTile.getValue() == 0) {
                                    // if also a zero add to ties to be exploded
                                    toReveal.push(adjTile)
                                }
                            }
                        }
                    }

                    soFar++
                    if (safety-- < 0) {
                        console.log("Safety limit reached !!")
                        break
                    }
                }
            }
        }

        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i]
            if (!tile.isBomb() && !tile.used3BV) {
                value3BV++
                tile.is3BV = true
            }
        }

        return value3BV
    }
}

/**
 * Describes a single tile on a minesweeper board
 */

class ServerTile {
    constructor(index) {
        this.index = index
        this.iscovered = true
        this.value = 0
        this.isflagged = false
        this.exploded = false
        this.isbomb = false
        this.used3BV = false
        this.is3BV = false
    }

    reset() {
        this.iscovered = true
        this.isflagged = false
        this.exploded = false
        this.used3BV = false
        this.is3BV = false
    }

    getIndex() {
        return this.index
    }

    isCovered() {
        return this.iscovered
    }

    setNotCovered() {
        this.iscovered = false
    }

    getValue() {
        return this.value
    }

    toggleFlag() {
        if (!this.iscovered) {
            this.isflagged = false
            return
        }

        this.isflagged = !this.isflagged
    }

    isFlagged() {
        return this.isflagged
    }

    makeBomb() {
        this.isbomb = true
    }

    isBomb() {
        return this.isbomb
    }
}

// used to shuffle an array
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const x = a[i]
        a[i] = a[j]
        a[j] = x
    }
    return a
}

module.exports = {
    createNoGuessGame,
}
