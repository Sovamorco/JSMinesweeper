const {
    ACTION_FLAG,
    ACTION_CLEAR,
} = require("./consts")
const { ProbabilityEngine, Action } = require("./solverProbabilityEngine")

// solver entry point
async function solver(board) {
    // when initialising create some entry points to functions needed from outside
    if (board == null) {
        console.log("Solver Initialisation request received")
        solver.countSolutions = countSolutions
        return
    }

    // a bit of a bodge this variable is used as a global
    let fillerTiles = [] // this is used by the no-guess board generator

    let noMoves = 0
    let cleanActions = [] // these are the actions to take
    const otherActions = [] // this is other Actions of interest

    // allow the solver to bring back no moves 5 times. No moves is possible when playing no-flags
    while (noMoves < 5 && cleanActions.length == 0) {
        noMoves++
        const actions = await doSolve(board) // look for solutions

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i]

            if (action.action == ACTION_FLAG) {
                // if a request to flag

                const tile = board.getTileXY(action.x, action.y)
                if (!tile.isFlagged()) {
                    otherActions.push(action)
                }
            } else {
                cleanActions.push(action)
            }
        }
    }

    const reply = {}
    reply.actions = cleanActions
    reply.fillers = fillerTiles
    reply.other = otherActions

    return reply

    // **** functions below here ****

    // this finds the best moves
    async function doSolve(board) {
        // find all the tiles which are revealed and have un-revealed / un-flagged adjacent squares
        const allCoveredTiles = []
        const witnesses = []
        const witnessed = []
        const unflaggedMines = []

        let minesLeft = board.num_bombs
        let squaresLeft = 0

        const work = new Set() // use a map to deduplicate the witnessed tiles

        for (let i = 0; i < board.tiles.length; i++) {
            const tile = board.getTile(i)

            tile.clearHint() // clear any previous hints

            if (tile.isSolverFoundBomb()) {
                minesLeft--
                tile.setProbability(0)
                if (!tile.isFlagged()) {
                    unflaggedMines.push(tile)
                }
                continue // if the tile is a mine then nothing to consider
            } else if (tile.isCovered()) {
                squaresLeft++
                allCoveredTiles.push(tile)
                continue // if the tile hasn't been revealed yet then nothing to consider
            }

            const adjTiles = board.getAdjacent(tile)

            let needsWork = false
            for (let j = 0; j < adjTiles.length; j++) {
                const adjTile = adjTiles[j]
                if (adjTile.isCovered() && !adjTile.isSolverFoundBomb()) {
                    needsWork = true
                    work.add(adjTile.index)
                }
            }

            if (needsWork) {
                // the witness still has some unrevealed adjacent tiles
                witnesses.push(tile)
            }
        }

        // generate an array of tiles from the map
        for (let index of work) {
            const tile = board.getTile(index)
            tile.setOnEdge(true)
            witnessed.push(tile)
        }

        board.setHighDensity(squaresLeft, minesLeft)

        let result = []

        for (let tile of unflaggedMines) {
            result.push(new Action(tile.getX(), tile.getY(), 0, ACTION_FLAG))
        }

        // if there are no mines left to find the everything else is to be cleared
        if (minesLeft == 0) {
            for (let i = 0; i < allCoveredTiles.length; i++) {
                const tile = allCoveredTiles[i]

                tile.setProbability(1)
                result.push(new Action(tile.getX(), tile.getY(), 1, ACTION_CLEAR))
            }

            return result
        }

        const oldMineCount = result.length

        result.push(...trivial_actions(board, witnesses))

        if (result.length > oldMineCount) {
            return result
        }

        const pe = new ProbabilityEngine(board, witnesses, witnessed, squaresLeft, minesLeft)

        pe.process()

        if (pe.finalSolutionCount == 0) {
            throw new Error("The board is in an illegal state")
        }

        // If we have a full analysis then set the probabilities on the tile tooltips
        if (pe.fullAnalysis) {
            // Set the probability for each tile on the edge
            for (let i = 0; i < pe.boxes.length; i++) {
                for (let j = 0; j < pe.boxes[i].tiles.length; j++) {
                    pe.boxes[i].tiles[j].setProbability(pe.boxProb[i])
                }
            }

            // set all off edge probabilities
            for (let i = 0; i < board.tiles.length; i++) {
                const tile = board.getTile(i)

                if (tile.isSolverFoundBomb()) {
                    if (!tile.isFlagged()) {
                        tile.setProbability(0)
                    }
                } else if (tile.isCovered() && !tile.onEdge) {
                    tile.setProbability(pe.offEdgeProbability)
                }
            }
        }

        // if the tiles off the edge are definitely safe then clear them all
        let offEdgeAllSafe = false
        if (pe.offEdgeProbability == 1) {
            const edgeSet = new Set() // build a set containing all the on edge tiles
            for (let i = 0; i < witnessed.length; i++) {
                edgeSet.add(witnessed[i].index)
            }
            // any tiles not on the edge can be cleared
            for (let i = 0; i < allCoveredTiles.length; i++) {
                const tile = allCoveredTiles[i]
                if (!edgeSet.has(tile.index)) {
                    result.push(new Action(tile.getX(), tile.getY(), 1, ACTION_CLEAR))
                }
            }

            if (result.length > 0) {
                offEdgeAllSafe = true
            }
        } else if (pe.offEdgeProbability == 0 && pe.fullAnalysis) {
            const edgeSet = new Set() // build a set containing all the on edge tiles
            for (let i = 0; i < witnessed.length; i++) {
                edgeSet.add(witnessed[i].index)
            }
            // any tiles not on the edge are a mine
            for (let i = 0; i < allCoveredTiles.length; i++) {
                const tile = allCoveredTiles[i]
                if (!edgeSet.has(tile.index) && !tile.isFlagged()) {
                    pe.minesFound.push(tile)
                }
            }
        }

        // have we found any local clears which we can use or everything off the edge is safe
        if (pe.localClears.length > 0 || pe.minesFound.length > 0 || offEdgeAllSafe) {
            for (let tile of pe.localClears) {
                // place each local clear into an action
                tile.setProbability(1)
                const action = new Action(tile.getX(), tile.getY(), 1, ACTION_CLEAR)
                result.push(action)
            }

            for (let tile of pe.minesFound) {
                tile.setProbability(0)
                tile.setFoundBomb()
                const action = new Action(tile.getX(), tile.getY(), 0, ACTION_FLAG)
                result.push(action)
            }

            return result
        }

        // this is part of the no-guessing board creation logic
        if (pe.bestProbability < 1) {
            if (pe.bestOnEdgeProbability >= pe.offEdgeProbability) {
                result.push(pe.getBestCandidates(1)) // get best options
            } else {
                const bestGuessTile = offEdgeGuess(board, witnessed)
                result.push(new Action(bestGuessTile.getX(), bestGuessTile.getY(), pe.offEdgeProbability), ACTION_CLEAR)
            }

            // find some witnesses which can be adjusted to remove the guessing
            findBalancingCorrections(pe)

            return result
        }

        return result
    }

    function trivial_actions(board, witnesses) {
        const result = new Map()

        for (let i = 0; i < witnesses.length; i++) {
            const tile = witnesses[i]

            const adjTiles = board.getAdjacent(tile)

            let flags = 0
            let covered = 0
            for (let j = 0; j < adjTiles.length; j++) {
                const adjTile = adjTiles[j]
                if (adjTile.isSolverFoundBomb()) {
                    flags++
                } else if (adjTile.isCovered()) {
                    covered++
                }
            }

            // if the tile has the correct number of flags then the other adjacent tiles are clear
            if (flags == tile.getValue() && covered > 0) {
                for (let j = 0; j < adjTiles.length; j++) {
                    const adjTile = adjTiles[j]
                    if (adjTile.isCovered() && !adjTile.isSolverFoundBomb()) {
                        adjTile.setProbability(1) // definite clear
                        result.set(adjTile.index, new Action(adjTile.getX(), adjTile.getY(), 1, ACTION_CLEAR))
                    }
                }

                // if the tile has n remaining covered squares and needs n more flags then all the adjacent files are flags
            } else if (tile.getValue() == flags + covered && covered > 0) {
                for (let j = 0; j < adjTiles.length; j++) {
                    const adjTile = adjTiles[j]
                    if (adjTile.isCovered() && !adjTile.isSolverFoundBomb()) {
                        // if covered, not already a known mine and isn't flagged
                        adjTile.setProbability(0) // definite mine
                        adjTile.setFoundBomb()
                        //if (!adjTile.isFlagged()) {  // if not already flagged then flag it
                        result.set(adjTile.index, new Action(adjTile.getX(), adjTile.getY(), 0, ACTION_FLAG))
                        //}
                    }
                }
            }
        }

        // send it back as an array
        return Array.from(result.values())
    }

    /**
     * Find the best guess off the edge when the probability engine doesn't give the best guess as on edge
     */
    function offEdgeGuess(board, witnessed) {
        const edgeSet = new Set() // build a set containing all the on edge tiles
        for (let i = 0; i < witnessed.length; i++) {
            edgeSet.add(witnessed[i].index)
        }

        let bestGuess
        let bestGuessCount = 9

        for (let i = 0; i < board.tiles.length; i++) {
            const tile = board.getTile(i)

            // if we are an unrevealed square and we aren't on the edge
            // then store the location
            if (tile.isCovered() && !tile.isSolverFoundBomb() && !edgeSet.has(tile.index)) {
                // if the tile is covered and not on the edge

                const adjCovered = board.adjacentCoveredCount(tile)

                // if we only have isolated tiles then use this
                if (adjCovered == 0 && bestGuessCount == 9) {
                    bestGuess = tile
                }

                if (adjCovered > 0 && adjCovered < bestGuessCount) {
                    bestGuessCount = adjCovered
                    bestGuess = tile
                }
            }
        }

        return bestGuess
    }

    function countSolutions(board, notMines) {
        // find all the tiles which are revealed and have un-revealed / un-flagged adjacent squares
        const allCoveredTiles = []
        const witnesses = []
        const witnessed = []

        let minesLeft = board.num_bombs
        let squaresLeft = 0

        const work = new Set() // use a map to deduplicate the witnessed tiles

        for (let i = 0; i < board.tiles.length; i++) {
            const tile = board.getTile(i)

            if (tile.isSolverFoundBomb()) {
                minesLeft--
                continue // if the tile is a flag then nothing to consider
            } else if (tile.isCovered()) {
                squaresLeft++
                allCoveredTiles.push(tile)
                continue // if the tile hasn't been revealed yet then nothing to consider
            }

            const adjTiles = board.getAdjacent(tile)

            let needsWork = false
            let minesFound = 0
            for (let j = 0; j < adjTiles.length; j++) {
                const adjTile = adjTiles[j]
                if (adjTile.isSolverFoundBomb()) {
                    minesFound++
                } else if (adjTile.isCovered()) {
                    needsWork = true
                    work.add(adjTile.index)
                }
            }

            // if a witness needs work (still has hidden adjacent tiles) or is broken then add it to the mix
            if (needsWork || minesFound > tile.getValue()) {
                witnesses.push(tile)
            }
        }

        // generate an array of tiles from the map
        for (let index of work) {
            const tile = board.getTile(index)
            tile.setOnEdge(true)
            witnessed.push(tile)
        }

        var solutionCounter = new SolutionCounter(board, witnesses, witnessed, squaresLeft, minesLeft)

        solutionCounter.process()

        return solutionCounter
    }

    // when looking to fix a board to be no-guess, look for witnesses which can have mines added or removed to make then no longer guesses
    function findBalancingCorrections(pe) {
        const adders = [...pe.prunedWitnesses]
        adders.sort((a, b) => adderSort(a, b))

        let balanced = false

        for (let i = 0; i < adders.length; i++) {
            const boxWitness = adders[i]

            if (findBalance(boxWitness, adders)) {
                balanced = true
                break
            }
        }

        if (!balanced) {
            fillerTiles = []
        }
    }

    function findBalance(boxWitness, adders) {
        // these are the adjustments which will all the tile to be trivially solved
        const toRemove = boxWitness.minesToFind
        const toAdd = boxWitness.tiles.length - toRemove

        top: for (let balanceBox of adders) {
            if (balanceBox.tile.isEqual(boxWitness.tile)) {
                continue
            }

            // ensure the balancing witness doesn't overlap with this one
            for (let adjTile of board.getAdjacent(balanceBox.tile)) {
                if (adjTile.isCovered() && !adjTile.isSolverFoundBomb()) {
                    if (adjTile.isAdjacent(boxWitness.tile)) {
                        continue top
                    }
                }
            }

            const toRemove1 = balanceBox.minesToFind
            const toAdd1 = balanceBox.tiles.length - toRemove1

            if (toAdd1 == toRemove) {
                addFillings(boxWitness, false) // remove from here
                addFillings(balanceBox, true) // add to here
                return true
            }

            if (toRemove1 == toAdd) {
                addFillings(boxWitness, true) // add to here
                addFillings(balanceBox, false) // remove from here
                return true
            }
        }

        return false
    }

    function adderSort(a, b) {
        // tiels with smallest area first
        let c = a.tiles.length - b.tiles.length

        // then by the number of mines to find
        if (c == 0) {
            c = a.minesToFind - b.minesToFind
        }

        return c
    }

    function addFillings(boxWitness, fill) {
        for (let adjTile of boxWitness.tiles) {
            if (adjTile.isCovered() && !adjTile.isSolverFoundBomb()) {
                const filler = new Filling(adjTile.index, adjTile.x, adjTile.y, fill)
                fillerTiles.push(filler)
            }
        }
    }
}

// location with probability of being safe
class Filling {
    constructor(index, x, y, fill) {
        this.index = index
        this.x = x
        this.y = y
        this.fill = fill // mines left to find
    }

    asText() {
        return "(" + this.x + "," + this.y + ") Fill " + this.fill
    }
}

module.exports = {
    solver,
}
