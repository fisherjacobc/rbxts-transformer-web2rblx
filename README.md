<p align="center">
  <h1 align="center"><b>rbxts-transformer-web2rblx</b></h1>
  <p align="center">
    Roblox UI development with React, made simple.
    <br />
    <a href="https://npmjs.com/package/rbxts-transformer-web2rblx"><img alt="NPM Version" src="https://img.shields.io/npm/v/rbxts-transformer-web2rblx?style=for-the-badge"></a>
    <img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/fisherjacobc/rbxts-transformer-web2rblx/ci.yaml?style=for-the-badge&label=CI">
    <img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/fisherjacobc/rbxts-transformer-web2rblx/publish.yaml?style=for-the-badge&label=Publish">
  </p>
</p>

> [!IMPORTANT]
> This package requires roblox-ts version 3.0 or later.
> If you're using an older version of roblox-ts, you'll need to update to the latest version.
>
> Additionally, this package requires @rbxts/react.

## 📦 Setup

### Installation

> [!WARNING]
> This package has not released 1.0.0 yet, please make sure you use the @next tag or it will not install

Get started by installing `rbxts-transformer-web2rblx`
```sh
npm install rbxts-transformer-web2rblx@next
yarn add rbxts-transformer-web2rblx@next
pnpm add rbxts-transformer-web2rblx@next
```

### Configuration

Add the transformer to your tsconfig.json, and include the `jsx.d.ts` file
```ts
{   
    "compilerOptions": {
        ...
        "plugins": [
			{
				"transform": "rbxts-transformer-web2rblx",
				"cssFilePath": "src/roblox.css",
			}
		]
    },
    "include": [..., "node_modules/rbxts-transformer-web2rblx/jsx.d.ts"]
}
```

Change `cssFilePath` to the path of your css file

## 🚀 Using This Package

- As of now, you can only list 1 css file
- You can manually write your own css stylings to use
- You can also use other tools that generate/compile to css

### Using with Tailwindcss

You can use this pacakge in conjunction with Tailwindcss 🥳!

#### Install Tailwindcss
```sh
npm install -D tailwindcss
npx tailwindcss init
```
(you can use the yarn and pnpm equivelants of course)

#### Configure your file paths
Add the paths to all of your template files in your tailwind.config.js file.
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

#### Create an import file
This is **not** what you put in the tsconfig. This file is where you put in manually written css stylings, and where you put the tailwind utilities directive.
> [!TIP]
> I recommend not adding the `@tailwind base` or `@tailwind components` directive, as they clutter up the output file and don't really affect the transformer.
```css
@tailwind utilities
```

#### Start the Tailwind CLI build process
Run the CLI tool to scan your tsx files for classes and build your CSS.
```sh
npx tailwindcss -i ./src/input.css -o ./src/output.css --watch
```

#### Start using Tailwind!
You're all set!


## 🖌️ CSS Class Support

Want to request something else to be supported? [Submit a request!](https://github.com/fisherjacobc/rbxts-transformer-web2rblx/issues/new?assignees=&labels=&projects=&template=feature_request.yaml&title=feat%3A+)

### Currently Supported
- Flex (align-items, justify-content, gap, flex-direction)
- Background (color with transparency)
- Border (size, color, transparency)
- Font (face, weight, styling)
- Positioning (Left, Top, Right, Bottom)
- Origin (anchor point)
- Padding
- Text (size, color, transparency, alignment)
- Size (width, height, min/max)
- Aspect Ratio
- Rounding


## Future Support Coming Soon
- Rich Text styling support
- Flex (justify-self, align-self, grow)
- Shadows
- Overflow (overflow-x, overflow-y)
- All things hover

## 📝 License

This project is licensed under the [MIT license](LICENSE).