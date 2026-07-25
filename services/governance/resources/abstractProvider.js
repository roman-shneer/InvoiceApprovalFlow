class AbstractProvider {
    generateUserPrompt(invoice) {
        return `Analyze this invoice payload: ` + JSON.stringify(invoice)
    }

}

module.exports = AbstractProvider;