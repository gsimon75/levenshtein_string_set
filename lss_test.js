const fs = require("fs");
const readline = require("node:readline");
const readlinePromises = require("node:readline/promises");
const { CaseInsensitiveLevenshteinStringSet } = require("./levenshtein_string_set");


async function train_model(wordlist_file_name, model_file_name) {
    const lss = new CaseInsensitiveLevenshteinStringSet();

    console.log("Training the model...");
    const re_worddef = /^(?<word>.*) \((?<classes>.*)\)$/
    const rl = readline.createInterface({
        input: fs.createReadStream(wordlist_file_name),
        crlfDelay: Infinity,
    });
    for await (const line of rl) {
        const m = line.match(re_worddef);
        if (m) {
            lss.add_string(m.groups.word);
        }
    }
    console.log("Ready...");

    const ofs = fs.openSync(model_file_name, "w", 0o600);
    fs.writeFileSync(ofs, lss.serialise());
    fs.closeSync(ofs);
    return lss;
}


async function load_model(model_file_name) {
    const lss = new CaseInsensitiveLevenshteinStringSet();
    console.log("Loading the model...");
    const dictree = fs.readFileSync(model_file_name, "utf8");
    lss.deserialise(dictree);
    console.log("Ready...");
    return lss;
}


(async () => {
    /*await train_model("english.words", "english.lss");
    process.exit(0);*/

    //const lss = await load_model("english.lss");
    const lss = await load_model("purchase_invoice_items.lss");

    // test the model
    const rl_stdin = readlinePromises.createInterface({
        input: process.stdin,
        output: process.stdout,
        crlfDelay: Infinity,
    });
    while (true) {
        const line = await rl_stdin.question("Lookup> ");
        if (!line) {
            break;
        }
        const resp = lss.lookup(line);
        for (let i = 0; i < 10; i++) {
            console.log(`  ${i}: ${JSON.stringify(resp.next().value)}`);
        }
    }
    console.log("Bye.");
    process.exit(0);
})();
