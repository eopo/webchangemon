import * as fs from "fs/promises";
import * as nodemailer from "nodemailer";

function log(message) {
    console.log(`${new Date().toJSON()}: ${message}`);
}

function bootstrapHandleError(options) {
    return function handleError(error, customMsg, mail) {
        const message = `${error.message}
        ${customMsg}`;
        log(message);

        // Only send an email when error did not occur during email sending in order to create no loop.
        if (!mail)
            this.sendEmail({
                subject: `${options.mailTitle}: Fehler`,
                content: message,
            });
        process.exit(1);
    };
}

function bootstrapFormatDateHelper(options) {
    return function (timestamp) {
        return new Date(timestamp).toLocaleString(options.locale, {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    };
}

function bootstrapWriteToDisk(options) {
    return async function (data) {
        await fs.writeFile(options.dataPath, JSON.stringify(data, null, 2));
    };
}

function bootstrapSendEmail(options, transporterIn) {
    return async function (message) {
        const transporter = transporterIn;

        const mailOptions = {
            from: options.fromMail,
            to: options.toMail,
            subject: message.subject,
            html: message.content,
        };

        try {
            const info = await transporter.sendMail(mailOptions);
            log(`Message sent to ${info.accepted}: ${info.messageId}`);
        } catch (error) {
            handleError(
                error,
                `Failed sending email to ${options.toMail}`,
                true // Third parameter must be true, because else we would create a loop!
            );
        }
    };
}

function bootstrapFormatEmail(options) {
    return function formatEmail(changes) {
        const messages = changes.map((e) => options.formatChange(e));
        const content =
            messages.join("<br/><br/>") +
            `<br/><br/>Datenstand: ${this.formatDateHelper(new Date())}`;
            
        const subject = `${changes.length} ${
            options.mailTitle
        } ge??ndert um ${new Date().toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
        })}`;
        return { content, subject };
    };
}

function bootstrapGetHistoricData(options) {
    return async function () {
        try {
            const file = await fs.readFile(options.dataPath, "utf-8");
            return JSON.parse(file);
        } catch (error) {
            log('Could not find historic data. File will be created on next run.');
            return [];
        }
    };
}

function bootstrapRun(options) {
    return async function run() {
        try {
            const currentArray = await options.getCurrentData();
            const previousArray = await this.getHistoricData();
            const changes = options.compareData(currentArray, previousArray);
            if (changes.length > 0) {
                const email = this.formatEmail(changes);
                this.sendEmail(email);
            } else {
                this.log(`No changes made`);
            }
            
            // If application provides a function to reduce file size, use it. If not, write whole current array to disk.
            await this.writeToDisk(typeof options.reduceData === 'function' ? options.reduceData(currentArray) : currentArray);
        } catch (error) {
            this.handleError(error);
        }
    };
}

export function bootstrap(options) {
    const transporter = nodemailer.createTransport(options.smtpString);

    const app = {
        options,
        log,
        handleError: bootstrapHandleError(options),
        getHistoricData: bootstrapGetHistoricData(options),
        formatDateHelper: bootstrapFormatDateHelper(options),
        writeToDisk: bootstrapWriteToDisk(options),
        sendEmail: bootstrapSendEmail(options, transporter),
        formatEmail: bootstrapFormatEmail(options),
        run: bootstrapRun(options),
    };
    return app;
}
